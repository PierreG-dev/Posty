import { generatedPostSchema, type GeneratedPost } from "./generated-post";
import { POST_CONTENT_MAX, POST_LINE1_MAX } from "./post";
import type { Theme } from "./theme";
import { deriveTargetLength } from "./length-policy";
import { defaultRegistry, type VisualRegistry } from "@/modules/linkedin/visuals/registry";
import "@/modules/linkedin/visuals/register";

// CDC-01 §8.8 — validateur strict, appelé par les TROIS points d'entrée :
// génération API, import JSON manuel, éditeur UI.

export type ValidationSeverity = "error" | "warning";

export interface ValidationError {
  path: string;
  message: string;
  severity: ValidationSeverity;
}

export type ValidationResult =
  | { ok: true; post: GeneratedPost; warnings: ValidationError[] }
  | { ok: false; errors: ValidationError[]; warnings: ValidationError[] };

// Markdown : gras `**...**`, titres `# ` en début de ligne, puce `- ` en début de ligne.
const MARKDOWN_RE = /\*\*|^#{1,6}\s|^\s*-\s/m;
const URL_RE = /https?:\/\//i;

export function validateGeneratedPost(
  raw: unknown,
  theme: Theme,
  registry: VisualRegistry = defaultRegistry(),
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // 1. Parse schéma de base (types + limites LinkedIn dures).
  const parsed = generatedPostSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
        severity: "error",
      });
    }
    return { ok: false, errors, warnings };
  }
  const post = parsed.data;
  const content = post.content;

  // 2. Longueur dure LinkedIn (le schéma le fait déjà, mais on garde une règle
  // explicite pour la traçabilité §8.8).
  if (content.length > POST_CONTENT_MAX) {
    errors.push({
      path: "content",
      message: `content.length=${content.length} > ${POST_CONTENT_MAX} (limite dure LinkedIn)`,
      severity: "error",
    });
  }

  // 3. Première ligne ≤ POST_LINE1_MAX (le hook doit tenir avant « voir plus »).
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.length > POST_LINE1_MAX) {
    errors.push({
      path: "content",
      message: `Première ligne : ${firstLine.length} caractères > ${POST_LINE1_MAX}`,
      severity: "error",
    });
  }

  // 4. Markdown détecté — LinkedIn l'affiche littéralement.
  if (MARKDOWN_RE.test(content)) {
    errors.push({
      path: "content",
      message: "Markdown détecté (**, # ou puce -). LinkedIn l'affiche littéralement.",
      severity: "error",
    });
  }

  // 5. URL dans le corps — les liens vont en firstComment (§10.6).
  if (URL_RE.test(content)) {
    errors.push({
      path: "content",
      message: "URL détectée dans le corps. Les liens doivent aller dans firstComment.",
      severity: "error",
    });
  }

  // 6. Hashtags : entre 3 et 5, tous bien formés (regex déjà appliquée par le schéma).
  if (post.hashtags.length < 3 || post.hashtags.length > 5) {
    errors.push({
      path: "hashtags",
      message: `hashtags: ${post.hashtags.length} fournis, attendu 3 à 5`,
      severity: "error",
    });
  }

  // 7. Formulations interdites du thème.
  const lower = content.toLowerCase();
  for (const phrase of theme.ai.forbiddenPhrases) {
    if (phrase && lower.includes(phrase.toLowerCase())) {
      errors.push({
        path: "content",
        message: `Formulation interdite : "${phrase}"`,
        severity: "error",
      });
    }
  }

  // 8. Visuel / carrousel — délégué au registry (§9.2). Au lot 5, stub = null.
  const visualSchema = registry.visualSchema(theme.visual.mode);
  const visualCheck = visualSchema.safeParse(post.visual);
  if (!visualCheck.success) {
    for (const issue of visualCheck.error.issues) {
      errors.push({
        path: ["visual", ...issue.path.map(String)].join("."),
        message: issue.message,
        severity: "error",
      });
    }
  }
  const carouselSchema = registry.carouselSchema(theme.visual.mode);
  const carouselCheck = carouselSchema.safeParse(post.carousel);
  if (!carouselCheck.success) {
    for (const issue of carouselCheck.error.issues) {
      errors.push({
        path: ["carousel", ...issue.path.map(String)].join("."),
        message: issue.message,
        severity: "error",
      });
    }
  }

  // 9. AVERTISSEMENT non bloquant — longueur hors fourchette dérivée.
  const range = deriveTargetLength(theme);
  if (content.length < range.min || content.length > range.max) {
    warnings.push({
      path: "content",
      message: `Longueur ${content.length} hors de la fourchette [${range.min}, ${range.max}]`,
      severity: "warning",
    });
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, post, warnings };
}
