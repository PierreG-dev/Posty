import { z } from "zod";

// CDC-02 §4.5 — file d'envoi. Le rendu (subject/body) est FIGÉ à l'enfilement
// (§5.1) : ce qui est en base est ce qui partira, indépendamment d'un
// changement ultérieur de template, de bloc, ou de méta contact.
//
// Idempotence : deux index uniques partiels — cf. mail-queue-model.ts.

export const MAIL_QUEUE_STATUSES = [
  "pending",
  "sending",
  "sent",
  "failed",
  "cancelled",
] as const;
export type MailQueueStatus = (typeof MAIL_QUEUE_STATUSES)[number];

export const MAIL_QUEUE_KINDS = ["sequence", "campaign"] as const;
export type MailQueueKind = (typeof MAIL_QUEUE_KINDS)[number];

// Priority — §6.2. Nombre bas = plus prioritaire.
// 1 = relance (step 1 ou 2), 2 = premier contact (step 0), 3 = campagne.
export const MAIL_QUEUE_PRIORITIES = [1, 2, 3] as const;
export type MailQueuePriority = (typeof MAIL_QUEUE_PRIORITIES)[number];

export const mailQueueSnapshotSchema = z.object({
  name: z.string(),
  email: z.string(),
  greeting: z.string(),
});
export type MailQueueSnapshot = z.infer<typeof mailQueueSnapshotSchema>;

export const mailQueueThreadingSchema = z.object({
  inReplyTo: z.string().nullable(),
  references: z.string().nullable(),
});
export type MailQueueThreading = z.infer<typeof mailQueueThreadingSchema>;

export const mailQueueEntrySchema = z.object({
  _id: z.string(),
  companyId: z.string().min(1),
  kind: z.enum(MAIL_QUEUE_KINDS),
  sequenceStep: z.number().int().min(0).max(2).nullable(),
  campaignId: z.string().nullable(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  subject: z.string(),
  body: z.string(),
  snapshot: mailQueueSnapshotSchema,
  threading: mailQueueThreadingSchema.nullable(),
  status: z.enum(MAIL_QUEUE_STATUSES),
  attempts: z.number().int().min(0),
  lastError: z.string().nullable(),
  messageId: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.date(),
  sentAt: z.date().nullable(),
  updatedAt: z.date(),
});
export type MailQueueEntry = z.infer<typeof mailQueueEntrySchema>;
