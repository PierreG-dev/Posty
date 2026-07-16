import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { BLOCK_KINDS } from "@/modules/mailing/domain/mail-blocks";

const mailBlockSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 60, unique: true },
    kind: { type: String, enum: BLOCK_KINDS, required: true },
    content: { type: String, required: true },
    isDefault: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, collection: "mail_blocks" },
);

export type MailBlockDoc = InferSchemaType<typeof mailBlockSchema> & { _id: string };

type MailBlockModelT = Model<MailBlockDoc>;
export const MailBlockModel: MailBlockModelT =
  (models.MailBlock as MailBlockModelT | undefined) ??
  model<MailBlockDoc>("MailBlock", mailBlockSchema);
