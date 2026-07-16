import { z } from "zod";
import { HASHTAG_RE } from "./theme";
import { POST_CONTENT_MAX, ALT_TEXT_MAX } from "./post";

// CDC-01 §8.7 — contrat de sortie de la génération IA.
// Le champ `visual`/`carousel` est un schéma OUVERT ici (unknown). Le validateur
// (§8.8) délègue au registry visuel (§9.1) le contrôle des limites de caractères
// de chaque template. Au lot 5, le registry stub renvoie z.null().

const hashtagSchema = z.string().regex(HASHTAG_RE, "Format attendu : #MotSansEspace");

export const generatedPostSchema = z.object({
  content: z.string().trim().min(1).max(POST_CONTENT_MAX),
  hashtags: z.array(hashtagSchema).default([]),
  firstComment: z.string().trim().nullable().default(null),
  visual: z.unknown().default(null),
  carousel: z.unknown().default(null),
  altText: z.string().max(ALT_TEXT_MAX).default(""),
});

export type GeneratedPost = z.infer<typeof generatedPostSchema>;
