import { z } from "zod";

// Les 4 patterns de hook autorisés (CDC-01 §8.4).
export const HOOK_PATTERNS = ["aveu", "chiffre", "erreur-commune", "question-fermee"] as const;
export type HookPattern = (typeof HOOK_PATTERNS)[number];

export const VISUAL_MODES = ["none", "image", "carousel"] as const;
export type VisualMode = (typeof VISUAL_MODES)[number];

// Bornes utiles pour l'UI. Volontairement souples : le validateur strict
// (§8.8) vit au lot 5 et pourra durcir ces limites au moment de la génération.
export const THEME_NAME_MAX = 60;
export const THEME_DESC_MAX = 240;
export const HASHTAG_RE = /^#[A-Za-z0-9_]+$/;

const hashtagsSchema = z
  .array(z.string().regex(HASHTAG_RE, "Format attendu : #MotSansEspace"))
  .max(10, "10 hashtags max");

export const themeInputSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis").max(THEME_NAME_MAX),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Slug : minuscules, chiffres, tirets uniquement")
    .optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Couleur hex #RRGGBB attendue")
    .default("#FFB020"),
  emoji: z.string().trim().max(4).default(""),
  description: z.string().trim().max(THEME_DESC_MAX).default(""),

  ai: z
    .object({
      enabled: z.boolean().default(true),
      systemPrompt: z.string().trim().default(""),
      structure: z.string().trim().default(""),
      // null = dérivée du média (§8.3). Nombre positif = surcharge.
      targetLength: z.number().int().positive().nullable().default(null),
      hookPatterns: z.array(z.enum(HOOK_PATTERNS)).default([]),
      examples: z.array(z.string().trim().min(1)).default([]),
      forbiddenPhrases: z.array(z.string().trim().min(1)).default([]),
    })
    .default({}),

  visual: z
    .object({
      mode: z.enum(VISUAL_MODES).default("none"),
      templateId: z.string().nullable().default(null),
      // Ignoré si mode != 'carousel'.
      carouselSlides: z.number().int().min(3).max(10).default(5),
    })
    .default({}),

  defaultHashtags: hashtagsSchema.default([]),
  active: z.boolean().default(true),
});

export type ThemeInput = z.infer<typeof themeInputSchema>;

export const themeDocSchema = themeInputSchema.extend({
  _id: z.string(),
  slug: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Theme = z.infer<typeof themeDocSchema>;

/** Slugifie un nom. Utilisé si aucun slug n'est fourni au create. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
