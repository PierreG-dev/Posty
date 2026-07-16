import { z } from "zod";

// CDC-02 §4.3 — 3 templates de séquence, indexés par step ∈ {0,1,2}.

export const SEQUENCE_STEPS = [0, 1, 2] as const;
export type SequenceStep = (typeof SEQUENCE_STEPS)[number];

export const mailTemplateInputSchema = z.object({
  step: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  subject: z.string().trim().min(1).max(200),
  // corps avec placeholders : {{GREETING}} et {{BLOCK:<name>}}
  body: z.string().min(1),
  blockIds: z.array(z.string()).default([]),
});
export type MailTemplateInput = z.infer<typeof mailTemplateInputSchema>;

export const mailTemplateSchema = mailTemplateInputSchema.extend({
  _id: z.string(),
  updatedAt: z.date(),
});
export type MailTemplate = z.infer<typeof mailTemplateSchema>;
