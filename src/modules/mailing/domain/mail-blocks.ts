import { z } from "zod";

// CDC-02 §4.2 — blocs rigides réutilisables (signature, footer, custom).

export const BLOCK_KINDS = ["signature", "footer", "custom"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const mailBlockInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(BLOCK_KINDS),
  content: z.string().min(1), // texte brut, multi-lignes
  isDefault: z.boolean().default(false),
});
export type MailBlockInput = z.infer<typeof mailBlockInputSchema>;

export const mailBlockSchema = mailBlockInputSchema.extend({
  _id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MailBlock = z.infer<typeof mailBlockSchema>;
