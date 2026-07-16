import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { SLOT_MODE_OVERRIDES, TIME_RE } from "@/modules/linkedin/domain/slot";

const slotSchema = new Schema(
  {
    label: { type: String, default: "", maxlength: 60 },
    dayOfWeek: { type: Number, required: true, min: 1, max: 7 },
    time: {
      type: String,
      required: true,
      validate: {
        validator: (v: string) => TIME_RE.test(v),
        message: "time doit être HH:mm",
      },
    },
    themeId: { type: Schema.Types.ObjectId, ref: "Theme", required: true },
    modeOverride: { type: String, enum: SLOT_MODE_OVERRIDES, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "slots" },
);

slotSchema.index({ active: 1, dayOfWeek: 1, time: 1 });

export type SlotMongoDoc = InferSchemaType<typeof slotSchema> & { _id: string };

type SlotModelT = Model<SlotMongoDoc>;
export const SlotModel: SlotModelT =
  (models.Slot as SlotModelT | undefined) ?? model<SlotMongoDoc>("Slot", slotSchema);
