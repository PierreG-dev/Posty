import { Types } from "mongoose";
import { logger } from "@/modules/shared/logger";
import { env } from "@/modules/shared/env";
import { connectDb } from "@/modules/shared/db/mongoose";
import { getTheme } from "@/modules/linkedin/repositories/theme-repo";
import { listPosts, createPost, getPost, updatePost } from "@/modules/linkedin/repositories/post-repo";
import { PostModel } from "@/modules/linkedin/repositories/post-model";
import { saveGeneratedPng, saveGeneratedPdf } from "@/modules/linkedin/repositories/asset-repo";
import { renderTemplateToPng, renderCarouselToPdf, CANVAS_SIZE } from "@/modules/linkedin/visuals/render";
import type { Theme } from "@/modules/linkedin/domain/theme";
import type { Post, PostInput } from "@/modules/linkedin/domain/post";
import type { GeneratedPost } from "@/modules/linkedin/domain/generated-post";
import {
  validateGeneratedPost,
  type ValidationError,
} from "@/modules/linkedin/domain/validate-generated-post";
import {
  buildSystemPrompt,
  buildUserPrompt,
  PROMPT_VERSION,
} from "./prompt-builder";
import {
  getAnthropicClient,
  type AnthropicClient,
} from "@/modules/linkedin/ai/anthropic-client";
import { defaultRegistry, type VisualRegistry } from "@/modules/linkedin/visuals/registry";

// CDC-01 §8.2 — UNE seule fonction, appelée par les DEUX points d'entrée.

export interface GenerateVariantOk {
  ok: true;
  post: GeneratedPost;
  warnings: ValidationError[];
  rawResponse: string;
  attempts: number;
}
export interface GenerateVariantErr {
  ok: false;
  errors: ValidationError[];
  warnings: ValidationError[];
  rawResponse: string;
  attempts: number;
}
export type GenerateVariant = GenerateVariantOk | GenerateVariantErr;

export interface GenerationResult {
  themeId: string;
  model: string;
  promptVersion: string;
  variants: GenerateVariant[];
  /** Renseigné SI `persist=true` : un post créé par variante réussie. */
  createdPosts: Post[];
}

export interface GenerateOptions {
  variants?: 1 | 3;
  persist?: boolean;
  client?: AnthropicClient;
  registry?: VisualRegistry;
}

const RECENT_LIMIT = 10;

/** Extrait le premier bloc JSON de la réponse. Rejette backticks/préambule. */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    throw new Error("Réponse en backticks (```). Contrat §8.7 : JSON brut, sans préambule.");
  }
  if (!trimmed.startsWith("{")) {
    throw new Error("La réponse ne commence pas par `{`. Contrat §8.7 : JSON brut, sans préambule.");
  }
  return JSON.parse(trimmed);
}

/**
 * Une génération unique (un appel Claude + parse + validation + 1 retry).
 */
async function generateOne(
  theme: Theme,
  recent: Post[],
  client: AnthropicClient,
  registry: VisualRegistry,
): Promise<GenerateVariant> {
  const system = buildSystemPrompt(theme, registry);
  const user = buildUserPrompt(theme, recent, registry);

  const attempt = async (extraUserSuffix?: string): Promise<GenerateVariant & { rawResponse: string }> => {
    const finalUser = extraUserSuffix ? `${user}\n\n${extraUserSuffix}` : user;
    const res = await client.call({ system, user: finalUser });
    const raw = res.text;

    let parsed: unknown;
    try {
      parsed = extractJson(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        errors: [{ path: "(root)", message: msg, severity: "error" }],
        warnings: [],
        rawResponse: raw,
        attempts: 1,
      };
    }

    const validation = validateGeneratedPost(parsed, theme, registry);
    if (validation.ok) {
      return {
        ok: true,
        post: validation.post,
        warnings: validation.warnings,
        rawResponse: raw,
        attempts: 1,
      };
    }
    return {
      ok: false,
      errors: validation.errors,
      warnings: validation.warnings,
      rawResponse: raw,
      attempts: 1,
    };
  };

  const first = await attempt();
  if (first.ok) return first;

  // 1 retry en citant les erreurs exactes (§8.8).
  const errorList = first.errors.map((e) => `- ${e.path} : ${e.message}`).join("\n");
  const retryHint = [
    "Ton JSON précédent a été rejeté par le validateur. Erreurs :",
    errorList,
    "",
    "Corrige et renvoie UNIQUEMENT le JSON valide. Pas d'excuse, pas de commentaire.",
  ].join("\n");
  const second = await attempt(retryHint);
  return { ...second, attempts: 2 };
}

/** §8.6 — 10 derniers posts publiés du thème, ordre chronologique décroissant. */
async function loadRecent(themeId: string): Promise<Post[]> {
  const published = await listPosts({ status: "published", themeId });
  return published.slice(0, RECENT_LIMIT);
}

function toPostInput(theme: Theme, variant: GenerateVariantOk): PostInput {
  const firstCommentText = variant.post.firstComment?.trim() || null;
  // status='draft' pour ne PAS polluer la file — le worker publie
  // immédiatement via publishPost (claimForPublishing accepte draft).
  return {
    content: variant.post.content,
    hashtags: variant.post.hashtags.length > 0 ? variant.post.hashtags : theme.defaultHashtags,
    themeId: theme._id,
    status: "draft",
    source: "ai",
    media: {
      kind: "none",
      assetId: null,
      altText: variant.post.altText,
      title: "",
    },
    firstComment: {
      text: firstCommentText,
      status: firstCommentText ? "pending" : "none",
    },
    queuePosition: 0,
    scheduledAt: null,
    sourceExternalId: null,
  };
}

/**
 * §8.2 — le point d'entrée UNIQUE.
 * - UI (bouton Générer)     → variants=3, persist=false → l'utilisateur choisit puis met en file.
 * - UI (Tester la génération) → variants=1, persist=false.
 * - Worker mode auto        → variants=1, persist=true → publié directement.
 */
export async function generatePost(
  themeId: string,
  opts: GenerateOptions = {},
): Promise<GenerationResult> {
  const variants = opts.variants ?? 3;
  const persist = opts.persist ?? false;
  const registry = opts.registry ?? defaultRegistry();
  const client = opts.client ?? getAnthropicClient();

  const theme = await getTheme(themeId);
  if (!theme) throw new Error(`Thème ${themeId} introuvable`);
  if (!theme.ai.enabled) {
    throw new Error(`Thème « ${theme.name} » : génération IA désactivée dans les réglages du thème.`);
  }

  const recent = await loadRecent(themeId);

  logger.info("linkedin.generator.start", { themeId, variants, persist });
  const runs = await Promise.all(
    Array.from({ length: variants }, () => generateOne(theme, recent, client, registry)),
  );

  const createdPosts: Post[] = [];
  if (persist) {
    for (const v of runs) {
      if (!v.ok) continue;
      const input = toPostInput(theme, v);
      const created = await createPost(input);
      // Enrichit aiMeta après création (createPost n'accepte pas aiMeta).
      await enrichAiMeta(created._id, {
        model: env().ANTHROPIC_MODEL,
        promptVersion: PROMPT_VERSION,
        generatedAt: new Date(),
        editedByHuman: false,
      });
      // §9 — si la variante décrit un visuel, on le rend et on l'attache.
      // Rendu ici (pas au tick suivant) : ainsi le post est publiable direct.
      // Un échec de rendu ne fait PAS échouer la création — le post reste
      // en draft sans média et l'incident est loggué.
      await attachVisualIfAny(created._id, theme, v.post).catch((err) => {
        logger.warn("linkedin.generator.visual_attach_failed", {
          postId: created._id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
      const refreshed = await getPost(created._id);
      createdPosts.push(refreshed ?? created);
    }
  }

  logger.info("linkedin.generator.done", {
    themeId,
    variants,
    okCount: runs.filter((r) => r.ok).length,
    persisted: createdPosts.length,
  });

  return {
    themeId,
    model: env().ANTHROPIC_MODEL,
    promptVersion: PROMPT_VERSION,
    variants: runs,
    createdPosts,
  };
}

/**
 * §9 — attache le visuel décrit par la variante générée au post créé.
 * Le validateur a déjà vérifié la conformité du JSON contre le registry ;
 * ici on rend et on persiste l'asset.
 */
async function attachVisualIfAny(
  postId: string,
  theme: Theme,
  generated: GeneratedPost,
): Promise<void> {
  const altText = generated.altText || "";
  if (theme.visual.mode === "image") {
    const v = generated.visual as { templateId: string; params: unknown } | null;
    if (!v) return;
    const png = await renderTemplateToPng(v.templateId, v.params);
    const asset = await saveGeneratedPng(
      png,
      { templateId: v.templateId, params: v.params, promptVersion: PROMPT_VERSION },
      { width: CANVAS_SIZE, height: CANVAS_SIZE },
    );
    await updatePost(postId, {
      media: {
        kind: "image",
        assetId: asset._id,
        altText: altText || `Visuel généré : ${v.templateId}`,
        title: "",
      },
    });
    return;
  }
  if (theme.visual.mode === "carousel") {
    const c = generated.carousel as { slides: Array<{ templateId: string; params: unknown }> } | null;
    if (!c || !c.slides || c.slides.length === 0) return;
    const pdf = await renderCarouselToPdf(c.slides);
    const asset = await saveGeneratedPdf(pdf, {
      templateId: "carousel",
      params: { slides: c.slides },
      promptVersion: PROMPT_VERSION,
    });
    await updatePost(postId, {
      media: {
        kind: "document",
        assetId: asset._id,
        altText: altText || `Carrousel généré (${c.slides.length} slides)`,
        title: (generated.content.split("\n", 1)[0] ?? "Carrousel").slice(0, 100),
      },
    });
  }
}

// Patch minimal pour poser aiMeta après createPost (postInputSchema n'expose
// pas aiMeta — c'est un champ interne renseigné par le générateur uniquement).
async function enrichAiMeta(
  postId: string,
  meta: { model: string; promptVersion: string; generatedAt: Date; editedByHuman: boolean },
): Promise<Post | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(postId)) return null;
  await PostModel.updateOne({ _id: postId }, { $set: { aiMeta: meta } });
  return getPost(postId);
}
