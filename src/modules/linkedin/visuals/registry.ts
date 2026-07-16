import { z } from "zod";
import type { ReactElement } from "react";
import type { VisualMode } from "@/modules/linkedin/domain/theme";
import type { DesignTokens } from "@/modules/linkedin/design/tokens";

// CDC-01 §9.1 — Registry visuel.
// Un template = un fichier dans templates/ qui exporte `default: VisualTemplate<P>`.
// L'auto-enregistrement passe par ./register.ts (import-side-effect).
// Le générateur, le validateur (§8.8) et le contrat JSON (§8.7) DÉRIVENT
// du registry — jamais maintenus à la main.

export interface VisualTemplate<P = unknown> {
  id: string;
  label: string;
  kind: "post" | "slide" | "both";
  /** Zod schema qui porte les LIMITES DE CARACTÈRES (§9.2). */
  schema: z.ZodType<P>;
  /** Injecté dans le prompt de génération (§8.9). */
  promptHint: string;
  /** Rendu Satori. */
  render(params: P, tokens: DesignTokens): ReactElement;
}

export interface VisualTemplateInfo {
  id: string;
  label: string;
  kind: "post" | "slide" | "both";
  promptHint: string;
}

/** Un item de slide de carrousel — templateId + params du template. */
export interface SlideParams {
  templateId: string;
  params: unknown;
}

export interface VisualRegistry {
  listTemplates(mode: VisualMode): VisualTemplateInfo[];
  visualSchema(mode: VisualMode): z.ZodTypeAny;
  carouselSchema(mode: VisualMode): z.ZodTypeAny;
  promptHints(mode: VisualMode): string;
  contractFragment(mode: VisualMode): { visual: string; carousel: string };
}

// ---------------------------------------------------------------------------
// Store interne — alimenté par register.ts au module load.
// ---------------------------------------------------------------------------

const templates = new Map<string, VisualTemplate<unknown>>();

export function registerTemplate<P>(t: VisualTemplate<P>): void {
  if (templates.has(t.id)) {
    // Idempotent en HMR (Next re-évalue les modules).
    templates.set(t.id, t as unknown as VisualTemplate<unknown>);
    return;
  }
  templates.set(t.id, t as unknown as VisualTemplate<unknown>);
}

export function getTemplate(id: string): VisualTemplate<unknown> | undefined {
  return templates.get(id);
}

export function _resetTemplatesForTest(): void {
  templates.clear();
}

// ---------------------------------------------------------------------------
// Filtre par mode : quels templates éligibles pour `visual.mode` du thème.
// - mode='none'     → aucun template éligible
// - mode='image'    → templates dont kind='post' ou 'both'
// - mode='carousel' → templates dont kind='slide' ou 'both'
// ---------------------------------------------------------------------------

function templatesForMode(mode: VisualMode): VisualTemplate<unknown>[] {
  if (mode === "none") return [];
  const wanted = mode === "image" ? ["post", "both"] : ["slide", "both"];
  return [...templates.values()].filter((t) => wanted.includes(t.kind));
}

// ---------------------------------------------------------------------------
// Schémas construits dynamiquement.
// Chaque template contribue un objet zod : { templateId: literal, params: schema }.
// Le champ `visual`/`carousel` du contrat §8.7 est une union discriminante sur
// `templateId`. En mode='none', on impose null.
// ---------------------------------------------------------------------------

function buildDiscriminated(list: VisualTemplate<unknown>[]): z.ZodTypeAny {
  if (list.length === 0) return z.null();
  const options = list.map((t) =>
    z.object({
      templateId: z.literal(t.id),
      params: t.schema,
    }),
  );
  // Union classique — pas z.discriminatedUnion car le discriminant est nested.
  if (options.length === 1) return z.union([options[0]!, z.null()]);
  const [first, second, ...rest] = options;
  return z.union([first!, second!, ...rest, z.null()]);
}

function buildCarouselSchema(list: VisualTemplate<unknown>[]): z.ZodTypeAny {
  if (list.length === 0) return z.null();
  const slideOptions = list.map((t) =>
    z.object({
      templateId: z.literal(t.id),
      params: t.schema,
    }),
  );
  const slideUnion =
    slideOptions.length === 1
      ? slideOptions[0]!
      : z.union([slideOptions[0]!, slideOptions[1]!, ...slideOptions.slice(2)]);
  return z.union([
    z.object({
      slides: z.array(slideUnion).min(3, "3 slides minimum (§9.4)").max(10, "10 slides maximum (§9.4)"),
    }),
    z.null(),
  ]);
}

// ---------------------------------------------------------------------------
// Prompt hints — fragment listant les templates dispos et leurs limites.
// ---------------------------------------------------------------------------

function describeTemplate(t: VisualTemplate<unknown>): string {
  return `- ${t.id} (${t.label}) : ${t.promptHint}`;
}

function buildPromptHints(mode: VisualMode): string {
  if (mode === "none") {
    return 'Aucun visuel pour ce thème : réponds `"visual": null` et `"carousel": null`.';
  }
  const list = templatesForMode(mode);
  if (list.length === 0) {
    return `Aucun template disponible pour le mode "${mode}" : réponds \`"visual": null\` et \`"carousel": null\`.`;
  }
  if (mode === "image") {
    return [
      "Visuel : choisis UN template ci-dessous. Respecte STRICTEMENT les limites de caractères.",
      list.map(describeTemplate).join("\n"),
      "",
      'Format attendu : `"visual": { "templateId": "<id>", "params": { ... } }`. Si aucun visuel n\'est pertinent : `"visual": null`.',
      '`"carousel"` doit être null.',
    ].join("\n");
  }
  // carousel
  return [
    "Carrousel : 3 à 10 slides. Slide 1 = couverture avec promesse chiffrée. Une idée par slide. Dernière slide = CTA.",
    "Templates disponibles pour les slides :",
    list.map(describeTemplate).join("\n"),
    "",
    'Format attendu : `"carousel": { "slides": [ { "templateId": "<id>", "params": { ... } }, ... ] }`.',
    '`"visual"` doit être null.',
  ].join("\n");
}

function buildContractFragmentText(mode: VisualMode): { visual: string; carousel: string } {
  if (mode === "none") {
    return { visual: '"visual": null', carousel: '"carousel": null' };
  }
  const list = templatesForMode(mode);
  if (list.length === 0) {
    return { visual: '"visual": null', carousel: '"carousel": null' };
  }
  const ids = list.map((t) => `"${t.id}"`).join(" | ");
  if (mode === "image") {
    return {
      visual: `"visual": { "templateId": ${ids}, "params": { ... } } | null`,
      carousel: '"carousel": null',
    };
  }
  return {
    visual: '"visual": null',
    carousel: `"carousel": { "slides": [ { "templateId": ${ids}, "params": { ... } }, ... ] } | null   // 3 à 10 slides`,
  };
}

// ---------------------------------------------------------------------------
// Implémentation exposée.
// ---------------------------------------------------------------------------

export const realRegistry: VisualRegistry = {
  listTemplates(mode) {
    return templatesForMode(mode).map((t) => ({
      id: t.id,
      label: t.label,
      kind: t.kind,
      promptHint: t.promptHint,
    }));
  },
  visualSchema(mode) {
    if (mode !== "image") return z.null();
    return buildDiscriminated(templatesForMode(mode));
  },
  carouselSchema(mode) {
    if (mode !== "carousel") return z.null();
    return buildCarouselSchema(templatesForMode(mode));
  },
  promptHints: buildPromptHints,
  contractFragment: buildContractFragmentText,
};

/** Registry vide — utile pour les tests qui veulent isoler. */
export const emptyRegistry: VisualRegistry = {
  listTemplates: () => [],
  visualSchema: () => z.null(),
  carouselSchema: () => z.null(),
  promptHints: () =>
    "Aucun template visuel disponible pour l'instant : réponds `\"visual\": null` et `\"carousel\": null`.",
  contractFragment: () => ({
    visual: '"visual": null',
    carousel: '"carousel": null',
  }),
};

/** Registry par défaut — utilisé partout dans le code de production. */
export function defaultRegistry(): VisualRegistry {
  return realRegistry;
}

// NB : les templates s'auto-enregistrent au chargement de `./register`.
// Ne PAS importer register depuis registry (cycle qui casse l'ordre des
// bindings en ESM). Les consommateurs (générateur, validateur, routes)
// importent register.ts explicitement — le compilateur/bundler tree-shake
// les imports non-utilisés côté client, donc l'impact est nul.
