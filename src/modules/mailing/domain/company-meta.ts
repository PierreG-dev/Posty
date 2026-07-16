import { z } from "zod";

// CDC-02 §4.6 — métadonnées Posty dérivées d'un contact Twenty. Une entrée
// par companyId Twenty, créée à la demande (upsert).

export const PAUSED_REASONS = ["reply", "manual"] as const;
export type PausedReason = (typeof PAUSED_REASONS)[number];

export const BOUNCE_KINDS = ["hard", "soft"] as const;
export type BounceKind = (typeof BOUNCE_KINDS)[number];

export const bounceSchema = z.object({
  kind: z.enum(BOUNCE_KINDS),
  count: z.number().int().min(0),
  lastAt: z.date(),
  lastCode: z.string(),
});
export type Bounce = z.infer<typeof bounceSchema>;

export const companyMetaInputSchema = z.object({
  companyId: z.string().min(1),
  greeting: z.string().nullable().default(null),
  greetingEditedByHuman: z.boolean().default(false),
  paused: z.boolean().default(false),
  pausedReason: z.enum(PAUSED_REASONS).nullable().default(null),
  pausedAt: z.date().nullable().default(null),
  bounce: bounceSchema.nullable().default(null),
});
export type CompanyMetaInput = z.infer<typeof companyMetaInputSchema>;

export const companyMetaSchema = companyMetaInputSchema.extend({
  _id: z.string(),
  updatedAt: z.date(),
});
export type CompanyMeta = z.infer<typeof companyMetaSchema>;
