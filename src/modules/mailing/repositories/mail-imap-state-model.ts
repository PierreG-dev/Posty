import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const mailImapStateSchema = new Schema(
  {
    _id: { type: String, default: "singleton" },
    // Map folder name → { uidValidity, lastUid }. Mixed pour éviter les
    // problèmes d'échappement de clés (les noms IMAP peuvent contenir des
    // caractères spéciaux type '.', '/').
    folders: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: false, updatedAt: true }, collection: "mail_imap_state" },
);

export type MailImapStateDoc = InferSchemaType<typeof mailImapStateSchema> & { _id: string };

type MailImapStateModelT = Model<MailImapStateDoc>;
export const MailImapStateModel: MailImapStateModelT =
  (models.MailImapState as MailImapStateModelT | undefined) ??
  model<MailImapStateDoc>("MailImapState", mailImapStateSchema);
