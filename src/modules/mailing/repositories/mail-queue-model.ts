import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { MAIL_QUEUE_KINDS, MAIL_QUEUE_STATUSES } from "@/modules/mailing/domain/mail-queue";

// CDC-02 §4.5 — les DEUX index uniques partiels sont le garde-fou
// anti-double-envoi. Le tri par (status, priority, createdAt) sert la boucle
// d'envoi (§6.2).

const snapshotSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    greeting: { type: String, required: true },
  },
  { _id: false },
);

const threadingSchema = new Schema(
  {
    inReplyTo: { type: String, default: null },
    references: { type: String, default: null },
  },
  { _id: false },
);

const mailQueueSchema = new Schema(
  {
    companyId: { type: String, required: true, index: true },
    kind: { type: String, enum: MAIL_QUEUE_KINDS, required: true },
    sequenceStep: { type: Number, default: null },
    campaignId: { type: String, default: null },
    priority: { type: Number, enum: [1, 2, 3], required: true, index: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    snapshot: { type: snapshotSchema, required: true },
    threading: { type: threadingSchema, default: null },
    status: { type: String, enum: MAIL_QUEUE_STATUSES, required: true, default: "pending", index: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    messageId: { type: String, default: null },
    cancelReason: { type: String, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "mail_queue" },
);

// §4.5 — anti-doublon séquence : un contact ne reçoit qu'une seule fois le
// step N. Index unique PARTIEL (kind='sequence') pour ne pas gêner les
// campagnes qui ont sequenceStep=null.
mailQueueSchema.index(
  { companyId: 1, kind: 1, sequenceStep: 1 },
  { unique: true, partialFilterExpression: { kind: "sequence" } },
);

// §4.5 — anti-doublon campagne : un contact ne reçoit qu'une seule fois la
// campagne C. Partiel sur kind='campaign' pour la même raison.
mailQueueSchema.index(
  { companyId: 1, campaignId: 1 },
  { unique: true, partialFilterExpression: { kind: "campaign" } },
);

// §6.2 — tri de la boucle d'envoi.
mailQueueSchema.index({ status: 1, priority: 1, createdAt: 1 });

export type MailQueueMongoDoc = InferSchemaType<typeof mailQueueSchema> & {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
};

type MailQueueModelT = Model<MailQueueMongoDoc>;
export const MailQueueModel: MailQueueModelT =
  (models.MailQueue as MailQueueModelT | undefined) ??
  model<MailQueueMongoDoc>("MailQueue", mailQueueSchema);
