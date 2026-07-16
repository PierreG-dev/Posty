import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { connectDb } from "@/modules/shared/db/mongoose";
import { env } from "@/modules/shared/env";
import { AssetModel, type AssetMongoDoc, type AssetKind } from "./asset-model";

export interface Asset {
  _id: string;
  kind: AssetKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  linkedinUrn: string | null;
}

function toDomain(doc: AssetMongoDoc): Asset {
  return {
    _id: String(doc._id),
    kind: doc.kind,
    filename: doc.filename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    width: doc.width ?? 0,
    height: doc.height ?? 0,
    linkedinUrn: doc.linkedinUrn ?? null,
  };
}

function assetPath(filename: string): string {
  return path.join(env().ASSETS_DIR, filename);
}

export async function getAsset(id: string): Promise<Asset | null> {
  await connectDb();
  const doc = await AssetModel.findById(id).lean<AssetMongoDoc>();
  return doc ? toDomain(doc) : null;
}

export async function readAssetBinary(asset: Asset): Promise<Buffer> {
  return fs.readFile(assetPath(asset.filename));
}

export async function cacheLinkedInUrn(assetId: string, urn: string): Promise<void> {
  await connectDb();
  await AssetModel.updateOne({ _id: assetId }, { $set: { linkedinUrn: urn } });
}

export interface GeneratedFromMeta {
  templateId: string;
  params: unknown;
  promptVersion?: string | null;
}

/**
 * Persiste un PNG rendu par Satori (§9). Le fichier est écrit dans ASSETS_DIR
 * sous un nom unique ; le doc Mongo capture les params d'origine pour permettre
 * une régénération à l'identique.
 */
export async function saveGeneratedPng(
  buffer: Buffer,
  meta: GeneratedFromMeta,
  dims: { width: number; height: number },
): Promise<Asset> {
  await connectDb();
  const filename = `gen-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
  await fs.mkdir(env().ASSETS_DIR, { recursive: true });
  await fs.writeFile(assetPath(filename), buffer);
  const doc = await AssetModel.create({
    kind: "image",
    filename,
    mimeType: "image/png",
    sizeBytes: buffer.length,
    width: dims.width,
    height: dims.height,
    linkedinUrn: null,
    generatedFrom: {
      templateId: meta.templateId,
      params: meta.params,
      promptVersion: meta.promptVersion ?? null,
    },
  });
  return toDomain(doc.toObject() as AssetMongoDoc);
}

/** Idem pour un carrousel : PDF assemblé depuis N slides. */
export async function saveGeneratedPdf(
  buffer: Buffer,
  meta: GeneratedFromMeta,
): Promise<Asset> {
  await connectDb();
  const filename = `gen-${Date.now()}-${randomUUID().slice(0, 8)}.pdf`;
  await fs.mkdir(env().ASSETS_DIR, { recursive: true });
  await fs.writeFile(assetPath(filename), buffer);
  const doc = await AssetModel.create({
    kind: "pdf",
    filename,
    mimeType: "application/pdf",
    sizeBytes: buffer.length,
    width: 1200,
    height: 1200,
    linkedinUrn: null,
    generatedFrom: {
      templateId: meta.templateId,
      params: meta.params,
      promptVersion: meta.promptVersion ?? null,
    },
  });
  return toDomain(doc.toObject() as AssetMongoDoc);
}
