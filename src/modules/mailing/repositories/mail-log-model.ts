import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// CDC-02 §6 — journal des envois RÉELLEMENT effectués (SMTP OK). Sert de
// compteur pour le quota quotidien : la boucle §6.2 lit `sentAt` du jour
// (Paris) pour décider d'un envoi supplémentaire.

const mailLogSchema = new Schema(
  {
    queueId: { type: String, required: true, index: true },
    companyId: { type: String, required: true, index: true },
    kind: { type: String, enum: ["sequence", "campaign"], required: true },
    sequenceStep: { type: Number, default: null },
    campaignId: { type: String, default: null },
    toEmail: { type: String, required: true },
    subject: { type: String, required: true },
    messageId: { type: String, required: true },
    sentAt: { type: Date, required: true, index: true },
    dryRun: { type: Boolean, required: true, default: false },
    imapArchived: { type: Boolean, default: false },
  },
  { timestamps: false, collection: "mail_log" },
);

// Unicité du messageId — protège contre un double INSERT accidentel.
mailLogSchema.index({ messageId: 1 }, { unique: true });
// Le compteur du quota lit fréquemment `sentAt` filtré sur une journée.
mailLogSchema.index({ sentAt: 1, dryRun: 1 });

export type MailLogMongoDoc = InferSchemaType<typeof mailLogSchema> & { _id: string };

type MailLogModelT = Model<MailLogMongoDoc>;
export const MailLogModel: MailLogModelT =
  (models.MailLog as MailLogModelT | undefined) ??
  model<MailLogMongoDoc>("MailLog", mailLogSchema);
