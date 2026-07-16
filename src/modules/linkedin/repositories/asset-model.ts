import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// CDC-01 §6.4. Squelette au lot 3 (juste ce dont le publisher a besoin pour
// cacher `linkedinUrn`). Le générateur Satori du lot 6 étendra ce modèle
// (generatedFrom, dimensions, etc.).
export const ASSET_KINDS = ["image", "pdf"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

const assetSchema = new Schema(
  {
    kind: { type: String, enum: ASSET_KINDS, required: true },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    // Cache URN LinkedIn : si non-null, on ne ré-uploade PAS. Vidé par
    // suppression manuelle si l'asset doit être republié.
    linkedinUrn: { type: String, default: null },
    // Provenance lot 6 : renseigné dès que l'asset a été produit par un
    // template du registry (par la génération IA ou l'éditeur visuel).
    // Permet de retrouver les params d'origine pour régénérer/éditer.
    generatedFrom: {
      type: {
        templateId: { type: String, required: true },
        params: { type: Schema.Types.Mixed, required: true },
        promptVersion: { type: String, default: null },
      },
      default: null,
    },
  },
  { timestamps: true, collection: "assets" },
);

export type AssetMongoDoc = InferSchemaType<typeof assetSchema> & { _id: string };

type AssetModelT = Model<AssetMongoDoc>;
export const AssetModel: AssetModelT =
  (models.Asset as AssetModelT | undefined) ?? model<AssetMongoDoc>("Asset", assetSchema);
