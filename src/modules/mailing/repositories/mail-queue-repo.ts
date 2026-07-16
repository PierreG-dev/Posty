import { connectDb } from "@/modules/shared/db/mongoose";
import type {
  MailQueueEntry,
  MailQueueKind,
  MailQueuePriority,
  MailQueueSnapshot,
  MailQueueStatus,
  MailQueueThreading,
} from "@/modules/mailing/domain/mail-queue";
import { MailQueueModel, type MailQueueMongoDoc } from "./mail-queue-model";

function toDomain(doc: MailQueueMongoDoc): MailQueueEntry {
  return {
    _id: String(doc._id),
    companyId: doc.companyId,
    kind: doc.kind as MailQueueKind,
    sequenceStep: doc.sequenceStep ?? null,
    campaignId: doc.campaignId ?? null,
    priority: doc.priority as MailQueuePriority,
    subject: doc.subject,
    body: doc.body,
    snapshot: {
      name: doc.snapshot.name,
      email: doc.snapshot.email,
      greeting: doc.snapshot.greeting,
    },
    threading: doc.threading
      ? { inReplyTo: doc.threading.inReplyTo ?? null, references: doc.threading.references ?? null }
      : null,
    status: doc.status as MailQueueStatus,
    attempts: doc.attempts ?? 0,
    lastError: doc.lastError ?? null,
    messageId: doc.messageId ?? null,
    cancelReason: doc.cancelReason ?? null,
    createdAt: doc.createdAt,
    sentAt: doc.sentAt ?? null,
    updatedAt: doc.updatedAt,
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: number; codeName?: string };
  return e.code === 11000 || e.codeName === "DuplicateKey";
}

export interface EnqueueInput {
  companyId: string;
  kind: MailQueueKind;
  sequenceStep: number | null;
  campaignId: string | null;
  priority: MailQueuePriority;
  subject: string;
  body: string;
  snapshot: MailQueueSnapshot;
  threading: MailQueueThreading | null;
}

export type EnqueueResult =
  | { duplicate: false; entry: MailQueueEntry }
  | { duplicate: true };

/**
 * Insère UNE entrée. Duplicate (violation d'un des index uniques) = abandon
 * silencieux. C'est le garde-fou §4.5 : deux appels concurrents n'insèrent
 * qu'une seule ligne.
 */
export async function enqueue(input: EnqueueInput): Promise<EnqueueResult> {
  await connectDb();
  try {
    const doc = await MailQueueModel.create({
      companyId: input.companyId,
      kind: input.kind,
      sequenceStep: input.sequenceStep,
      campaignId: input.campaignId,
      priority: input.priority,
      subject: input.subject,
      body: input.body,
      snapshot: input.snapshot,
      threading: input.threading,
      status: "pending",
      attempts: 0,
    });
    return { duplicate: false, entry: toDomain(doc.toObject() as MailQueueMongoDoc) };
  } catch (err) {
    if (isDuplicateKeyError(err)) return { duplicate: true };
    throw err;
  }
}

export interface ListQueueQuery {
  status?: MailQueueStatus | MailQueueStatus[];
  companyId?: string;
  kind?: MailQueueKind;
  limit?: number;
}

export async function listQueue(query: ListQueueQuery = {}): Promise<MailQueueEntry[]> {
  await connectDb();
  const filter: Record<string, unknown> = {};
  if (query.status) {
    filter.status = Array.isArray(query.status) ? { $in: query.status } : query.status;
  }
  if (query.companyId) filter.companyId = query.companyId;
  if (query.kind) filter.kind = query.kind;
  const docs = await MailQueueModel.find(filter)
    .sort({ priority: 1, createdAt: 1 })
    .limit(Math.min(query.limit ?? 200, 500))
    .lean<MailQueueMongoDoc[]>();
  return docs.map(toDomain);
}

/**
 * Passe atomiquement une entrée de `pending` à `sending`. Le sender l'utilise
 * comme claim : deux processus concurrents ne peuvent pas récupérer la même
 * entrée.
 */
export async function claimNextPending(): Promise<MailQueueEntry | null> {
  await connectDb();
  const doc = await MailQueueModel.findOneAndUpdate(
    { status: "pending" },
    { $set: { status: "sending" } },
    {
      new: true,
      sort: { priority: 1, createdAt: 1 },
    },
  ).lean<MailQueueMongoDoc>();
  return doc ? toDomain(doc) : null;
}

export async function markSent(
  id: string,
  info: { messageId: string; sentAt: Date },
): Promise<void> {
  await connectDb();
  await MailQueueModel.updateOne(
    { _id: id },
    { $set: { status: "sent", messageId: info.messageId, sentAt: info.sentAt } },
  );
}

export async function markFailed(id: string, error: string): Promise<void> {
  await connectDb();
  await MailQueueModel.updateOne(
    { _id: id },
    {
      $set: { status: "failed", lastError: error.slice(0, 1000) },
      $inc: { attempts: 1 },
    },
  );
}

export async function markCancelled(id: string, reason: string): Promise<void> {
  await connectDb();
  await MailQueueModel.updateOne(
    { _id: id },
    { $set: { status: "cancelled", cancelReason: reason.slice(0, 200) } },
  );
}

/**
 * Réouvre une entrée `failed` en `pending`. Utilisée par l'action « Réessayer »
 * de l'UI (les échecs SMTP ne sont pas re-tentés automatiquement, cf. plan §8).
 */
export async function retryFailed(id: string): Promise<boolean> {
  await connectDb();
  const r = await MailQueueModel.updateOne(
    { _id: id, status: "failed" },
    { $set: { status: "pending", lastError: null } },
  );
  return r.modifiedCount > 0;
}

/**
 * Annule toutes les entrées `pending` d'un contact — utilisé quand un bounce
 * hard ou une pause tombe alors que des entrées sont déjà en file. Ne touche
 * pas aux entrées `sending` (elles sont déjà réclamées par un sender).
 */
export async function cancelPendingForCompany(
  companyId: string,
  reason: string,
): Promise<number> {
  await connectDb();
  const r = await MailQueueModel.updateMany(
    { companyId, status: "pending" },
    { $set: { status: "cancelled", cancelReason: reason.slice(0, 200) } },
  );
  return r.modifiedCount ?? 0;
}

export interface PendingBreakdown {
  total: number;
  byPriority: { p1: number; p2: number; p3: number };
}

export async function countPendingBreakdown(): Promise<PendingBreakdown> {
  await connectDb();
  const rows = await MailQueueModel.aggregate<{ _id: number; count: number }>([
    { $match: { status: "pending" } },
    { $group: { _id: "$priority", count: { $sum: 1 } } },
  ]);
  const byPriority = { p1: 0, p2: 0, p3: 0 };
  let total = 0;
  for (const r of rows) {
    total += r.count;
    if (r._id === 1) byPriority.p1 = r.count;
    else if (r._id === 2) byPriority.p2 = r.count;
    else if (r._id === 3) byPriority.p3 = r.count;
  }
  return { total, byPriority };
}
