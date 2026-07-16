import { connectDb } from "@/modules/shared/db/mongoose";
import { ThemeModel, type ThemeMongoDoc } from "./theme-model";
import { slugify, type ThemeInput, type Theme } from "@/modules/linkedin/domain/theme";
import { Types } from "mongoose";

function toDomain(doc: ThemeMongoDoc): Theme {
  return {
    _id: String(doc._id),
    name: doc.name,
    slug: doc.slug,
    color: doc.color,
    emoji: doc.emoji,
    description: doc.description,
    ai: {
      enabled: doc.ai.enabled,
      systemPrompt: doc.ai.systemPrompt,
      structure: doc.ai.structure,
      targetLength: doc.ai.targetLength ?? null,
      hookPatterns: [...doc.ai.hookPatterns],
      examples: [...doc.ai.examples],
      forbiddenPhrases: [...doc.ai.forbiddenPhrases],
    },
    visual: {
      mode: doc.visual.mode,
      templateId: doc.visual.templateId ?? null,
      carouselSlides: doc.visual.carouselSlides,
    },
    defaultHashtags: [...doc.defaultHashtags],
    active: doc.active,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function ensureUniqueSlug(base: string, ignoreId?: string): Promise<string> {
  let candidate = base;
  let n = 1;
  while (true) {
    const existing = await ThemeModel.findOne({ slug: candidate }).lean<ThemeMongoDoc>();
    if (!existing || (ignoreId && String(existing._id) === ignoreId)) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

export async function listThemes(opts: { includeArchived?: boolean } = {}): Promise<Theme[]> {
  await connectDb();
  const q = opts.includeArchived ? {} : { active: true };
  const docs = await ThemeModel.find(q).sort({ createdAt: -1 }).lean<ThemeMongoDoc[]>();
  return docs.map(toDomain);
}

export async function getTheme(id: string): Promise<Theme | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return null;
  const doc = await ThemeModel.findById(id).lean<ThemeMongoDoc>();
  return doc ? toDomain(doc) : null;
}

export async function createTheme(input: ThemeInput): Promise<Theme> {
  await connectDb();
  const desiredSlug = input.slug ?? slugify(input.name);
  const slug = await ensureUniqueSlug(desiredSlug);
  const created = await ThemeModel.create({ ...input, slug });
  return toDomain(created.toObject() as ThemeMongoDoc);
}

export async function updateTheme(id: string, patch: Partial<ThemeInput>): Promise<Theme | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return null;

  const finalPatch: Record<string, unknown> = { ...patch };
  if (patch.slug) {
    finalPatch.slug = await ensureUniqueSlug(patch.slug, id);
  } else if (patch.name) {
    const current = await ThemeModel.findById(id).lean<ThemeMongoDoc>();
    if (current && slugify(current.name) === current.slug) {
      // Slug auto-suivait le nom : on continue.
      finalPatch.slug = await ensureUniqueSlug(slugify(patch.name), id);
    }
  }

  const doc = await ThemeModel.findByIdAndUpdate(id, finalPatch, { new: true }).lean<ThemeMongoDoc>();
  return doc ? toDomain(doc) : null;
}

export async function archiveTheme(id: string): Promise<boolean> {
  const t = await updateTheme(id, { active: false });
  return t !== null;
}

export async function deleteTheme(id: string): Promise<boolean> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return false;
  const r = await ThemeModel.deleteOne({ _id: id });
  return r.deletedCount === 1;
}
