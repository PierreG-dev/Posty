import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { PAUSED_REASONS, BOUNCE_KINDS } from "@/modules/mailing/domain/company-meta";

const bounceSchema = new Schema(
  {
    kind: { type: String, enum: BOUNCE_KINDS, required: true },
    count: { type: Number, default: 0 },
    lastAt: { type: Date, required: true },
    lastCode: { type: String, default: "" },
  },
  { _id: false },
);

const companyMetaSchema = new Schema(
  {
    companyId: { type: String, required: true, unique: true, index: true },
    greeting: { type: String, default: null },
    greetingEditedByHuman: { type: Boolean, default: false },
    paused: { type: Boolean, default: false, index: true },
    pausedReason: { type: String, enum: PAUSED_REASONS, default: null },
    pausedAt: { type: Date, default: null },
    bounce: { type: bounceSchema, default: null },
  },
  { timestamps: { createdAt: false, updatedAt: true }, collection: "company_meta" },
);

export type CompanyMetaDoc = InferSchemaType<typeof companyMetaSchema> & { _id: string };

type CompanyMetaModelT = Model<CompanyMetaDoc>;
export const CompanyMetaModel: CompanyMetaModelT =
  (models.CompanyMeta as CompanyMetaModelT | undefined) ??
  model<CompanyMetaDoc>("CompanyMeta", companyMetaSchema);
