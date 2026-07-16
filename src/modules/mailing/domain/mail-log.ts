import { z } from "zod";

// CDC-02 §6 — journal des envois réellement effectués. C'est la source de
// vérité du quota quotidien : on compte les entrées de `mail_log` dont
// `sentAt` tombe sur la date du jour en zone Paris.

export const mailLogEntrySchema = z.object({
  _id: z.string(),
  queueId: z.string(),
  companyId: z.string(),
  kind: z.enum(["sequence", "campaign"]),
  sequenceStep: z.number().int().min(0).max(2).nullable(),
  campaignId: z.string().nullable(),
  toEmail: z.string(),
  subject: z.string(),
  messageId: z.string(),
  sentAt: z.date(),
  dryRun: z.boolean(),
  // imapArchived n'apparaît que lot 9 — champ prévu mais non exploité ici.
  imapArchived: z.boolean().default(false),
});
export type MailLogEntry = z.infer<typeof mailLogEntrySchema>;
