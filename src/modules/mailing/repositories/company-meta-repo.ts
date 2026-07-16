import { connectDb } from "@/modules/shared/db/mongoose";
import type { Bounce, CompanyMeta } from "@/modules/mailing/domain/company-meta";
import { CompanyMetaModel, type CompanyMetaDoc } from "./company-meta-model";

type WithTs = CompanyMetaDoc & { updatedAt: Date };

function toDomain(doc: WithTs): CompanyMeta {
  return {
    _id: String(doc._id),
    companyId: doc.companyId,
    greeting: doc.greeting ?? null,
    greetingEditedByHuman: doc.greetingEditedByHuman,
    paused: doc.paused,
    pausedReason: doc.pausedReason ?? null,
    pausedAt: doc.pausedAt ?? null,
    bounce: doc.bounce
      ? {
          kind: doc.bounce.kind,
          count: doc.bounce.count,
          lastAt: doc.bounce.lastAt,
          lastCode: doc.bounce.lastCode,
        }
      : null,
    updatedAt: doc.updatedAt,
  };
}

export async function getMeta(companyId: string): Promise<CompanyMeta | null> {
  await connectDb();
  const doc = await CompanyMetaModel.findOne({ companyId }).lean<WithTs>();
  return doc ? toDomain(doc) : null;
}

export async function listMetaByIds(companyIds: readonly string[]): Promise<Map<string, CompanyMeta>> {
  await connectDb();
  if (companyIds.length === 0) return new Map();
  const docs = await CompanyMetaModel.find({ companyId: { $in: [...companyIds] } }).lean<WithTs[]>();
  return new Map(docs.map((d) => [d.companyId, toDomain(d)]));
}

/**
 * Écrit la salutation générée par le service. Ne l'écrase JAMAIS si l'humain
 * l'a éditée à la main (§6.1 — la salutation est éditable, et la main humaine
 * gagne sur l'IA).
 */
export async function setGeneratedGreeting(companyId: string, greeting: string): Promise<CompanyMeta> {
  await connectDb();
  const doc = await CompanyMetaModel.findOneAndUpdate(
    { companyId, greetingEditedByHuman: { $ne: true } },
    { $set: { greeting } },
    { new: true, upsert: false },
  ).lean<WithTs>();
  if (doc) return toDomain(doc);
  // Soit le doc existe avec greetingEditedByHuman=true, soit il n'existe pas
  // du tout. On tente un insert; si conflit sur companyId, on relit.
  try {
    const created = await CompanyMetaModel.create({ companyId, greeting });
    return toDomain(created.toObject() as WithTs);
  } catch {
    const existing = await CompanyMetaModel.findOne({ companyId }).lean<WithTs>();
    if (!existing) throw new Error(`Meta introuvable pour ${companyId}`);
    return toDomain(existing);
  }
}

/**
 * Écriture d'une salutation par l'humain — pose le flag `greetingEditedByHuman`.
 */
export async function setManualGreeting(companyId: string, greeting: string): Promise<CompanyMeta> {
  await connectDb();
  const doc = await CompanyMetaModel.findOneAndUpdate(
    { companyId },
    { $set: { greeting, greetingEditedByHuman: true } },
    { new: true, upsert: true },
  ).lean<WithTs>();
  if (!doc) throw new Error(`Meta introuvable après upsert : ${companyId}`);
  return toDomain(doc);
}

export async function setPaused(
  companyId: string,
  paused: boolean,
  reason: "reply" | "manual" | null,
): Promise<CompanyMeta> {
  await connectDb();
  const patch = paused
    ? { paused: true, pausedReason: reason, pausedAt: new Date() }
    : { paused: false, pausedReason: null, pausedAt: null };
  const doc = await CompanyMetaModel.findOneAndUpdate(
    { companyId },
    { $set: patch },
    { new: true, upsert: true },
  ).lean<WithTs>();
  if (!doc) throw new Error(`Meta introuvable après upsert : ${companyId}`);
  return toDomain(doc);
}

/**
 * Métas correspondant à un état donné (§11 dashboard : bandeaux « réponses à
 * traiter · bounces récents »).
 */
export async function listMeta(filter: {
  paused?: boolean;
  pausedReason?: "reply" | "manual";
  bounceKind?: "hard" | "soft";
}): Promise<CompanyMeta[]> {
  await connectDb();
  const q: Record<string, unknown> = {};
  if (typeof filter.paused === "boolean") q.paused = filter.paused;
  if (filter.pausedReason) q.pausedReason = filter.pausedReason;
  if (filter.bounceKind) q["bounce.kind"] = filter.bounceKind;
  const docs = await CompanyMetaModel.find(q).sort({ pausedAt: -1 }).limit(200).lean<WithTs[]>();
  return docs.map(toDomain);
}

export async function setBounce(companyId: string, bounce: Bounce | null): Promise<CompanyMeta> {
  await connectDb();
  const doc = await CompanyMetaModel.findOneAndUpdate(
    { companyId },
    { $set: { bounce } },
    { new: true, upsert: true },
  ).lean<WithTs>();
  if (!doc) throw new Error(`Meta introuvable après upsert : ${companyId}`);
  return toDomain(doc);
}
