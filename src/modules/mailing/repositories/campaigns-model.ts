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

const campaignSchema = new Schema(
  {
    name: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    blockIds: { type: [String], default: [] },
    targetCompanyIds: { type: [String], default: [] },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: "draft", index: true },
    stats: { type: statsSchema, default: () => ({}) },
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
