import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import {
  POST_STATUSES,
  POST_SOURCES,
  MEDIA_KINDS,
  FIRST_COMMENT_STATUSES,
} from "@/modules/linkedin/domain/post";

const mediaSchema = new Schema(
  {
    kind: { type: String, enum: MEDIA_KINDS, default: "none" },
    assetId: { type: Schema.Types.ObjectId, ref: "Asset", default: null },
    altText: { type: String, default: "" },
    title: { type: String, default: "" },
  },
  { _id: false },
);

const firstCommentSchema = new Schema(
  {
    text: { type: String, default: null },
    status: { type: String, enum: FIRST_COMMENT_STATUSES, default: "none" },
  },
  { _id: false },
);

const linkedinSchema = new Schema(
  {
    urn: { type: String, default: null },
    url: { type: String, default: null },
  },
  { _id: false },
);

const aiMetaSchema = new Schema(
  {
    model: String,
    promptVersion: String,
    generatedAt: Date,
    editedByHuman: { type: Boolean, default: false },
  },
  { _id: false },
);

const postSchema = new Schema(
  {
    content: { type: String, required: true, maxlength: 3000 },
    hashtags: [{ type: String }],
    themeId: { type: Schema.Types.ObjectId, ref: "Theme", default: null },

    status: { type: String, enum: POST_STATUSES, default: "draft" },
    source: { type: String, enum: POST_SOURCES, default: "manual" },

    media: { type: mediaSchema, default: () => ({}) },
    firstComment: { type: firstCommentSchema, default: () => ({}) },

    queuePosition: { type: Number, default: 0 },
    scheduledAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    linkedin: { type: linkedinSchema, default: () => ({}) },

    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    aiMeta: { type: aiMetaSchema, default: null },

    // Ajout vs §6.3 : idempotence de la migration Sheets (§16).
    sourceExternalId: { type: String, default: null },
  },
  { timestamps: true, collection: "posts" },
);

// Index obligatoires (§6.3).
postSchema.index({ status: 1, themeId: 1, queuePosition: 1 });
postSchema.index({ status: 1, scheduledAt: 1 });
// Ajout idempotence migration. `sparse` : les posts non issus de migration ont sourceExternalId=null.
postSchema.index({ sourceExternalId: 1 }, { unique: true, sparse: true });

export type PostMongoDoc = InferSchemaType<typeof postSchema> & { _id: string };

type PostModelT = Model<PostMongoDoc>;
export const PostModel: PostModelT =
  (models.Post as PostModelT | undefined) ?? model<PostMongoDoc>("Post", postSchema);
