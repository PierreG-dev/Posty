import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Collection `locks` — verrous éphémères pour idempotence (CDC-01 §5).
// L'index TTL supprime automatiquement le document une fois `expiresAt` passé.
// Pas de renouvellement : le verrou meurt, on retente au tick suivant.

const lockSchema = new Schema(
  {
    _id: { type: String, required: true }, // clé du verrou, ex: "tick" ou "publish:{slotId}:{YYYY-MM-DD}"
    holder: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: "locks", timestamps: { createdAt: true, updatedAt: false } },
);

lockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type LockDoc = InferSchemaType<typeof lockSchema> & { _id: string };
type LockModelT = Model<LockDoc>;
export const LockModel: LockModelT =
  (models.Lock as LockModelT | undefined) ?? model<LockDoc>("Lock", lockSchema);
