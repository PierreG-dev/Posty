import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// CDC-01 §6.5 — journal d'exécution.
// L'index UNIQUE sur idempotencyKey est le garde-fou anti-double-publication.
export const PUBLICATION_OUTCOMES = [
  "published",
  "empty_queue",
  "generation_failed",
  "validation_failed",
  "api_failed",
  "comment_failed",
  "skipped",
] as const;
export type PublicationOutcome = (typeof PUBLICATION_OUTCOMES)[number];

export const PUBLICATION_MODES = ["queue", "auto", "manual", "scheduled"] as const;
export type PublicationMode = (typeof PUBLICATION_MODES)[number];

const publicationSchema = new Schema(
  {
    idempotencyKey: { type: String, required: true },
    postId: { type: Schema.Types.ObjectId, ref: "Post", default: null },
    slotId: { type: Schema.Types.ObjectId, ref: "Slot", default: null },
    triggeredAt: { type: Date, default: () => new Date() },
    mode: { type: String, enum: PUBLICATION_MODES, required: true },
    outcome: { type: String, enum: PUBLICATION_OUTCOMES, required: true },
    durationMs: { type: Number, default: 0 },
    linkedinStatus: { type: Number, default: null },
    linkedinResponse: { type: String, default: null }, // tronqué à 4 Ko par le publisher
    payloadSnapshot: { type: Schema.Types.Mixed, default: null }, // rempli en dryRun
    error: { type: String, default: null },
  },
  { timestamps: true, collection: "publications" },
);

publicationSchema.index({ idempotencyKey: 1 }, { unique: true });
publicationSchema.index({ triggeredAt: -1 });
publicationSchema.index({ postId: 1, triggeredAt: -1 });

export type PublicationMongoDoc = InferSchemaType<typeof publicationSchema> & { _id: string };

type PublicationModelT = Model<PublicationMongoDoc>;
export const PublicationModel: PublicationModelT =
  (models.Publication as PublicationModelT | undefined) ??
  model<PublicationMongoDoc>("Publication", publicationSchema);
