import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { CAMPAIGN_STATUSES } from "@/modules/mailing/domain/campaigns";

// CDC-02 §4.4 — état persistant d'une campagne. Les stats sont recalculables
// depuis mail_queue + mail_log mais on les cache ici pour l'affichage liste.

const statsSchema = new Schema(
  {
    total: { type: Number, default: 0 },
    enqueued: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    cancelled: { type: Number, default: 0 },
  },
  { _id: false },
);

// Rapport figé au moment de la mise en file. Utile pour diagnostiquer un écart
// entre `targetCompanyIds.length` et `stats.total` sans devoir aller dans les
// logs. Champ optionnel : les campagnes créées avant cet ajout n'en ont pas.
const enqueueReportSchema = new Schema(
  {
    candidates: { type: Number, required: true },
    enqueued: { type: Number, required: true },
    duplicates: { type: Number, required: true },
    noEmail: { type: Number, required: true },
    ineligible: { type: Number, required: true },
    errors: { type: Number, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const campaignSchema = new Schema(
  {
    name: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    blockIds: { type: [String], default: [] },
    targetCompanyIds: { type: [String], default: [] },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: "draft", index: true },
    stats: { type: statsSchema, default: () => ({}) },
    enqueueReport: { type: enqueueReportSchema, default: null },
    queuedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "campaigns" },
);

export type CampaignMongoDoc = InferSchemaType<typeof campaignSchema> & {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
};

type CampaignModelT = Model<CampaignMongoDoc>;
export const CampaignModel: CampaignModelT =
  (models.Campaign as CampaignModelT | undefined) ??
  model<CampaignMongoDoc>("Campaign", campaignSchema);
