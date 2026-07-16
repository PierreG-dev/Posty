import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const mailTemplateSchema = new Schema(
  {
    step: { type: Number, required: true, unique: true, min: 0, max: 2 },
    subject: { type: String, required: true, maxlength: 200 },
    body: { type: String, required: true },
    blockIds: [{ type: Schema.Types.ObjectId, ref: "MailBlock" }],
  },
  { timestamps: { createdAt: false, updatedAt: true }, collection: "mail_templates" },
);

export type MailTemplateDoc = InferSchemaType<typeof mailTemplateSchema> & { _id: string };

type MailTemplateModelT = Model<MailTemplateDoc>;
export const MailTemplateModel: MailTemplateModelT =
  (models.MailTemplate as MailTemplateModelT | undefined) ??
  model<MailTemplateDoc>("MailTemplate", mailTemplateSchema);
