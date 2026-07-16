import { Types } from "mongoose";
import { connectDb } from "@/modules/shared/db/mongoose";
import { PostModel, type PostMongoDoc } from "./post-model";
import type { Post, PostInput, PostStatus, PostDraft, PostSource } from "@/modules/linkedin/domain/post";

function toDomain(doc: PostMongoDoc): Post {
  return {
    _id: String(doc._id),
    content: doc.content,
    hashtags: [...doc.hashtags],
    themeId: doc.themeId ? String(doc.themeId) : null,
    status: doc.status,
    source: doc.source,
    media: {
      kind: doc.media.kind,
      assetId: doc.media.assetId ? String(doc.media.assetId) : null,
      altText: doc.media.altText,
      title: doc.media.title,
    },
    firstComment: {
      text: doc.firstComment.text ?? null,
      status: doc.firstComment.status,
    },
    queuePosition: doc.queuePosition,
    scheduledAt: doc.scheduledAt ?? null,
    publishedAt: doc.publishedAt ?? null,
    linkedin: {
      urn: doc.linkedin.urn ?? null,
      url: doc.linkedin.url ?? null,
    },
    attempts: doc.attempts,
    lastError: doc.lastError ?? null,
    aiMeta:
      doc.aiMeta && doc.aiMeta.model && doc.aiMeta.promptVersion && doc.aiMeta.generatedAt
        ? {
            model: doc.aiMeta.model,
            promptVersion: doc.aiMeta.promptVersion,
            generatedAt: doc.aiMeta.generatedAt,
            editedByHuman: doc.aiMeta.editedByHuman,
          }
        : null,
    sourceExternalId: doc.sourceExternalId ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export interface ListPostsQuery {
  status?: PostStatus;
  themeId?: string | null; // null explicite = "sans thème"
}

export async function listPosts(q: ListPostsQuery = {}): Promise<Post[]> {
  await connectDb();
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.themeId === null) filter.themeId = null;
  else if (typeof q.themeId === "string" && Types.ObjectId.isValid(q.themeId)) filter.themeId = q.themeId;

  const sort: Record<string, 1 | -1> =
    q.status === "queued"
      ? { queuePosition: 1, createdAt: 1 }
      : q.status === "scheduled"
        ? { scheduledAt: 1, createdAt: 1 }
        : q.status === "published"
          ? { publishedAt: -1 }
          : { createdAt: -1 };

  const docs = await PostModel.find(filter).sort(sort).lean<PostMongoDoc[]>();
  return docs.map(toDomain);
}

export async function countByStatus(): Promise<Record<PostStatus, number>> {
  await connectDb();
  const rows = await PostModel.aggregate<{ _id: PostStatus; n: number }>([
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);
  const out: Record<string, number> = {};
  for (const r of rows) out[r._id] = r.n;
  return {
    draft: out.draft ?? 0,
    queued: out.queued ?? 0,
    scheduled: out.scheduled ?? 0,
    publishing: out.publishing ?? 0,
    published: out.published ?? 0,
    failed: out.failed ?? 0,
    archived: out.archived ?? 0,
  };
}

export async function getPost(id: string): Promise<Post | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return null;
  const doc = await PostModel.findById(id).lean<PostMongoDoc>();
  return doc ? toDomain(doc) : null;
}

export async function createPost(input: PostInput): Promise<Post> {
  await connectDb();
  // Si on entre en queued, on prend la position en fin de file du thème.
  let queuePosition = input.queuePosition ?? 0;
  if (input.status === "queued") {
    const tail = await PostModel.find({ status: "queued", themeId: input.themeId ?? null })
      .sort({ queuePosition: -1 })
      .limit(1)
      .lean<PostMongoDoc[]>();
    const last = tail[0];
    queuePosition = last ? last.queuePosition + 1 : 0;
  }
  const created = await PostModel.create({ ...input, queuePosition });
  return toDomain(created.toObject() as PostMongoDoc);
}

export async function updatePost(id: string, patch: Partial<PostInput>): Promise<Post | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return null;
  const doc = await PostModel.findByIdAndUpdate(id, patch, { new: true }).lean<PostMongoDoc>();
  return doc ? toDomain(doc) : null;
}

/** Champs internes réservés au publisher (§10.4). Volontairement séparé de
 * `updatePost` pour distinguer les mutations UI des mutations pipeline. */
export interface PublishFieldsPatch {
  status?: PostStatus;
  publishedAt?: Date | null;
  linkedin?: { urn: string; url: string };
  attempts?: number;
  lastError?: string | null;
  incrementAttempts?: boolean;
}

export async function applyPublishOutcome(id: string, patch: PublishFieldsPatch): Promise<Post | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return null;
  const set: Record<string, unknown> = {};
  const inc: Record<string, number> = {};
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.publishedAt !== undefined) set.publishedAt = patch.publishedAt;
  if (patch.linkedin) {
    set["linkedin.urn"] = patch.linkedin.urn;
    set["linkedin.url"] = patch.linkedin.url;
  }
  if (patch.attempts !== undefined) set.attempts = patch.attempts;
  if (patch.lastError !== undefined) set.lastError = patch.lastError;
  if (patch.incrementAttempts) inc.attempts = 1;
  const update: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(inc).length > 0) update.$inc = inc;
  const doc = await PostModel.findByIdAndUpdate(id, update, { new: true }).lean<PostMongoDoc>();
  return doc ? toDomain(doc) : null;
}

/** Passe le post en `publishing` UNIQUEMENT s'il est dans un état publiable
 * (queued/scheduled/draft/failed). Empêche la double publication concurrente. */
export async function claimForPublishing(id: string): Promise<Post | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return null;
  const doc = await PostModel.findOneAndUpdate(
    { _id: id, status: { $in: ["queued", "scheduled", "draft", "failed"] } },
    { $set: { status: "publishing" } },
    { new: true },
  ).lean<PostMongoDoc>();
  return doc ? toDomain(doc) : null;
}

export async function deletePost(id: string): Promise<boolean> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return false;
  const r = await PostModel.deleteOne({ _id: id });
  return r.deletedCount === 1;
}

/**
 * Réordonne la file d'un thème donné.
 * `orderedIds` doit couvrir EXACTEMENT tous les posts queued du thème,
 * sinon la fonction refuse la mise à jour (garde-fou anti-perte).
 */
export async function reorderQueue(themeId: string | null, orderedIds: string[]): Promise<{ ok: boolean; reason?: string }> {
  await connectDb();
  const themeFilter: Record<string, unknown> = { status: "queued" };
  themeFilter.themeId = themeId && Types.ObjectId.isValid(themeId) ? new Types.ObjectId(themeId) : null;

  const existing = await PostModel.find(themeFilter).select("_id").lean<Pick<PostMongoDoc, "_id">[]>();
  const existingIds = existing.map((d) => String(d._id));

  if (existingIds.length !== orderedIds.length) {
    return { ok: false, reason: `orderedIds contient ${orderedIds.length} ids, la file en a ${existingIds.length}` };
  }
  const setA = new Set(existingIds);
  const setB = new Set(orderedIds);
  if (setA.size !== setB.size || [...setA].some((id) => !setB.has(id))) {
    return { ok: false, reason: "orderedIds ne correspond pas à la file actuelle" };
  }

  // bulkWrite atomique — pas de session mongo requise pour un update par _id.
  const ops = orderedIds.map((id, index) => ({
    updateOne: { filter: { _id: new Types.ObjectId(id) }, update: { $set: { queuePosition: index } } },
  }));
  if (ops.length) await PostModel.bulkWrite(ops);
  return { ok: true };
}

/** §7.2 mode 'queue' — tête de file FIFO pour un thème donné. */
export async function peekQueuedHead(themeId: string | null): Promise<Post | null> {
  await connectDb();
  const filter: Record<string, unknown> = { status: "queued" };
  filter.themeId = themeId && Types.ObjectId.isValid(themeId) ? new Types.ObjectId(themeId) : null;
  const doc = await PostModel.findOne(filter).sort({ queuePosition: 1, createdAt: 1 }).lean<PostMongoDoc>();
  return doc ? toDomain(doc) : null;
}

/** §7.1 3b — one-shots dus. Renvoie tous les `scheduled` avec `scheduledAt <= now`. */
export async function listScheduledDue(now: Date): Promise<Post[]> {
  await connectDb();
  const docs = await PostModel.find({ status: "scheduled", scheduledAt: { $lte: now } })
    .sort({ scheduledAt: 1 })
    .lean<PostMongoDoc[]>();
  return docs.map(toDomain);
}

/** §4/12 — nombre de posts en file par thème. Clé = themeId string, ou "" si null. */
export async function countQueuedByTheme(): Promise<Record<string, number>> {
  await connectDb();
  const rows = await PostModel.aggregate<{ _id: string | null; n: number }>([
    { $match: { status: "queued" } },
    { $group: { _id: "$themeId", n: { $sum: 1 } } },
  ]);
  const out: Record<string, number> = {};
  for (const r of rows) out[r._id ? String(r._id) : ""] = r.n;
  return out;
}

export async function bulkAssignTheme(postIds: string[], themeId: string | null): Promise<number> {
  await connectDb();
  const validIds = postIds.filter((id) => Types.ObjectId.isValid(id));
  if (!validIds.length) return 0;
  const themeVal = themeId && Types.ObjectId.isValid(themeId) ? new Types.ObjectId(themeId) : null;
  const r = await PostModel.updateMany({ _id: { $in: validIds } }, { $set: { themeId: themeVal } });
  return r.modifiedCount ?? 0;
}

export async function duplicatePost(id: string): Promise<Post | null> {
  const src = await getPost(id);
  if (!src) return null;
  const copy: PostInput = {
    content: src.content,
    hashtags: [...src.hashtags],
    themeId: src.themeId,
    status: "draft",
    source: "manual",
    media: { kind: "none", assetId: null, altText: "", title: "" },
    firstComment: { text: src.firstComment.text, status: "none" },
    queuePosition: 0,
    scheduledAt: null,
    sourceExternalId: null,
  };
  return createPost(copy);
}

/**
 * Insertion d'un lot importé (texte ou JSON). Tous les posts créés partagent
 * le themeId passé et entrent en `queued` à la fin de la file (dans l'ordre du batch).
 */
export async function importBatch(
  drafts: PostDraft[],
  opts: { themeId: string | null; source: PostSource; defaultHashtags?: string[] },
): Promise<Post[]> {
  await connectDb();
  const created: Post[] = [];

  const tail = await PostModel.find({ status: "queued", themeId: opts.themeId ?? null })
    .sort({ queuePosition: -1 })
    .limit(1)
    .lean<PostMongoDoc[]>();
  let pos = tail[0] ? tail[0].queuePosition + 1 : 0;

  for (const d of drafts) {
    const hashtags = d.hashtags.length ? d.hashtags : (opts.defaultHashtags ?? []);
    const input: PostInput = {
      content: d.content,
      hashtags,
      themeId: opts.themeId,
      status: "queued",
      source: opts.source,
      media: {
        kind: "none",
        assetId: null,
        altText: d.altText,
        title: "",
      },
      firstComment: {
        text: d.firstComment,
        status: d.firstComment ? "pending" : "none",
      },
      queuePosition: pos,
      scheduledAt: null,
      sourceExternalId: null,
    };
    pos += 1;
    const doc = await PostModel.create(input);
    created.push(toDomain(doc.toObject() as PostMongoDoc));
  }
  return created;
}
