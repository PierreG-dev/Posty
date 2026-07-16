import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Settings singleton — CDC-01 §6.6.
// Les champs LinkedIn (accessToken, refreshToken, authorUrn) sont chiffrés
// AU MOMENT DE L'ÉCRITURE dans le repository (shared/settings/repo.ts),
// jamais côté client. Ici le schéma les stocke tels quels (chaînes opaques).

const SINGLETON_ID = "singleton" as const;

const linkedinSchema = new Schema(
  {
    authorUrn: { type: String, default: null },
    accessToken: { type: String, default: null }, // chiffré AES-256-GCM
    refreshToken: { type: String, default: null }, // chiffré AES-256-GCM
    expiresAt: { type: Date, default: null },
    refreshExpiresAt: { type: Date, default: null },
  },
  { _id: false },
);

const pushoverSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    userKey: { type: String, default: null },
    appToken: { type: String, default: null },
  },
  { _id: false },
);

const aiSchema = new Schema(
  {
    model: { type: String, default: "claude-sonnet-5" },
    temperature: { type: Number, default: 1.0 },
  },
  { _id: false },
);

const settingsSchema = new Schema(
  {
    _id: { type: String, default: SINGLETON_ID },
    autoGeneration: { type: Boolean, default: false },
    dryRun: { type: Boolean, default: true },
    timezone: { type: String, default: "Europe/Paris" },
    minQueueAlert: { type: Number, default: 3 },
    pushover: { type: pushoverSchema, default: () => ({}) },
    linkedin: { type: linkedinSchema, default: () => ({}) },
    ai: { type: aiSchema, default: () => ({}) },
  },
  { timestamps: true, collection: "settings" },
);

export type SettingsDoc = InferSchemaType<typeof settingsSchema> & { _id: string };

type SettingsModelT = Model<SettingsDoc>;
export const SettingsModel: SettingsModelT =
  (models.Settings as SettingsModelT | undefined) ?? model<SettingsDoc>("Settings", settingsSchema);
export const SETTINGS_ID = SINGLETON_ID;
