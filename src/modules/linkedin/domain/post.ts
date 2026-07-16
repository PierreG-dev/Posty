import { z } from "zod";
import { HASHTAG_RE } from "./theme";

// CDC-01 §6.3.
export const POST_STATUSES = [
  "draft",
  "queued",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "archived",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_SOURCES = ["manual", "ai", "json-import", "sheets-migration"] as const;
export type PostSource = (typeof POST_SOURCES)[number];

export const MEDIA_KINDS = ["none", "image", "document"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

// Repli spike (docs/spike-linkedin.md) : l'API socialActions/comments est
// réservée aux Community Management Partners (403 avec `w_member_social`).
// On ne peut donc pas poster le premier commentaire depuis le serveur.
// L'énumération se limite à `none` (aucun commentaire prévu) et `pending`
// (texte prêt à coller, Pushover envoyé après publication).
export const FIRST_COMMENT_STATUSES = ["none", "pending"] as const;
export type FirstCommentStatus = (typeof FIRST_COMMENT_STATUSES)[number];

// Limite dure LinkedIn (CDC-01 §8.8).
export const POST_CONTENT_MAX = 3000;
export const POST_LINE1_MAX = 100;
export const ALT_TEXT_MAX = 120;

const hashtagSchema = z.string().regex(HASHTAG_RE, "Format attendu : #MotSansEspace");

const mediaSchema = z
  .object({
    kind: z.enum(MEDIA_KINDS).default("none"),
    assetId: z.string().nullable().default(null),
    altText: z.string().max(ALT_TEXT_MAX).default(""),
    title: z.string().max(200).default(""),
  })
  .default({})
  .superRefine((m, ctx) => {
    if (m.kind !== "none" && m.altText.trim().length === 0) {
      ctx.addIssue({ code: "custom", path: ["altText"], message: "Alt text obligatoire dès qu'il y a un média" });
    }
    if (m.kind === "document" && m.title.trim().length === 0) {
      ctx.addIssue({ code: "custom", path: ["title"], message: "Titre obligatoire pour un document" });
    }
  });

const firstCommentSchema = z
  .object({
    text: z.string().nullable().default(null),
    status: z.enum(FIRST_COMMENT_STATUSES).default("none"),
  })
  .default({});

const aiMetaSchema = z
  .object({
    model: z.string(),
    promptVersion: z.string(),
    generatedAt: z.date(),
    editedByHuman: z.boolean().default(false),
  })
  .nullable()
  .default(null);

export const postInputSchema = z.object({
  content: z.string().trim().min(1, "Contenu requis").max(POST_CONTENT_MAX, `${POST_CONTENT_MAX} caractères max`),
  hashtags: z.array(hashtagSchema).max(15).default([]),
  themeId: z.string().nullable().default(null),

  status: z.enum(POST_STATUSES).default("draft"),
  source: z.enum(POST_SOURCES).default("manual"),

  media: mediaSchema,
  firstComment: firstCommentSchema,

  queuePosition: z.number().int().nonnegative().default(0),
  scheduledAt: z.date().nullable().default(null),

  // Ajout par rapport au §6.3 : idempotence de la migration Sheets (§16).
  // Non exposé dans les formulaires — écrit uniquement par le script de migration.
  sourceExternalId: z.string().nullable().default(null),
});

export type PostInput = z.infer<typeof postInputSchema>;

export const postDocSchema = postInputSchema.extend({
  _id: z.string(),
  publishedAt: z.date().nullable().default(null),
  linkedin: z
    .object({
      urn: z.string().nullable().default(null),
      url: z.string().nullable().default(null),
    })
    .default({}),
  attempts: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable().default(null),
  aiMeta: aiMetaSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Post = z.infer<typeof postDocSchema>;

/** Import : sous-ensemble minimal d'un post pour l'onglet Importer. */
export const postDraftSchema = z.object({
  content: z.string().trim().min(1).max(POST_CONTENT_MAX),
  hashtags: z.array(hashtagSchema).max(15).default([]),
  firstComment: z.string().trim().nullable().default(null),
  altText: z.string().max(ALT_TEXT_MAX).default(""),
});

export type PostDraft = z.infer<typeof postDraftSchema>;
