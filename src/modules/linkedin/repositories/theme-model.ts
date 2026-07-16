import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { HOOK_PATTERNS, VISUAL_MODES } from "@/modules/linkedin/domain/theme";

const aiSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    systemPrompt: { type: String, default: "" },
    structure: { type: String, default: "" },
    targetLength: { type: Number, default: null },
    hookPatterns: [{ type: String, enum: HOOK_PATTERNS }],
    examples: [{ type: String }],
    forbiddenPhrases: [{ type: String }],
  },
  { _id: false },
);

const visualSchema = new Schema(
  {
    mode: { type: String, enum: VISUAL_MODES, default: "none" },
    templateId: { type: String, default: null },
    carouselSlides: { type: Number, default: 5, min: 3, max: 10 },
  },
  { _id: false },
);

const themeSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 60 },
    slug: { type: String, required: true, unique: true, maxlength: 60 },
    color: { type: String, default: "#FFB020" },
    emoji: { type: String, default: "" },
    description: { type: String, default: "", maxlength: 240 },

    ai: { type: aiSchema, default: () => ({}) },
    visual: { type: visualSchema, default: () => ({}) },

    defaultHashtags: [{ type: String }],
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, collection: "themes" },
);

export type ThemeMongoDoc = InferSchemaType<typeof themeSchema> & { _id: string };

type ThemeModelT = Model<ThemeMongoDoc>;
export const ThemeModel: ThemeModelT =
  (models.Theme as ThemeModelT | undefined) ?? model<ThemeMongoDoc>("Theme", themeSchema);
