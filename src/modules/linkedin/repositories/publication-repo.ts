import { connectDb } from "@/modules/shared/db/mongoose";
import {
  PublicationModel,
  type PublicationMongoDoc,
  type PublicationMode,
  type PublicationOutcome,
} from "./publication-model";

export interface Publication {
  _id: string;
  idempotencyKey: string;
  postId: string | null;
  slotId: string | null;
  triggeredAt: Date;
  mode: PublicationMode;
  outcome: PublicationOutcome;
  durationMs: number;
  linkedinStatus: number | null;
  linkedinResponse: string | null;
  payloadSnapshot: unknown;
  error: string | null;
  createdAt: Date;
}

function toDomain(doc: PublicationMongoDoc): Publication {
  return {
    _id: String(doc._id),
    idempotencyKey: doc.idempotencyKey,
    postId: doc.postId ? String(doc.postId) : null,
    slotId: doc.slotId ? String(doc.slotId) : null,
    triggeredAt: doc.triggeredAt,
    mode: doc.mode,
    outcome: doc.outcome,
    durationMs: doc.durationMs,
    linkedinStatus: doc.linkedinStatus ?? null,
    linkedinResponse: doc.linkedinResponse ?? null,
    payloadSnapshot: doc.payloadSnapshot ?? null,
    error: doc.error ?? null,
    createdAt: (doc as PublicationMongoDoc & { createdAt: Date }).createdAt,
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: number; codeName?: string };
  return e.code === 11000 || e.codeName === "DuplicateKey";
}

export interface CreatePublicationInput {
  idempotencyKey: string;
  postId?: string | null;
  slotId?: string | null;
  mode: PublicationMode;
  outcome: PublicationOutcome;
  durationMs?: number;
  linkedinStatus?: number | null;
  linkedinResponse?: string | null;
  payloadSnapshot?: unknown;
  error?: string | null;
}

export type CreatePublicationResult =
  | { duplicate: false; publication: Publication }
  | { duplicate: true; existing: Publication };

/**
 * Écrit une entrée `publications`. En cas de violation d'unicité sur
 * `idempotencyKey`, renvoie `{ duplicate: true, existing }` SANS throw.
 * C'est le garde-fou du §5 CDC-01 : un double appel du worker ne double pas
 * la publication.
 */
export async function createPublication(input: CreatePublicationInput): Promise<CreatePublicationResult> {
  await connectDb();
  try {
    const doc = await PublicationModel.create({
      idempotencyKey: input.idempotencyKey,
      postId: input.postId ?? null,
      slotId: input.slotId ?? null,
      mode: input.mode,
      outcome: input.outcome,
      durationMs: input.durationMs ?? 0,
      linkedinStatus: input.linkedinStatus ?? null,
      linkedinResponse: input.linkedinResponse ?? null,
      payloadSnapshot: input.payloadSnapshot ?? null,
      error: input.error ?? null,
    });
    return { duplicate: false, publication: toDomain(doc.toObject() as PublicationMongoDoc) };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const existing = await PublicationModel.findOne({ idempotencyKey: input.idempotencyKey }).lean<PublicationMongoDoc>();
    if (!existing) throw err;
    return { duplicate: true, existing: toDomain(existing) };
  }
}

export interface ListPublicationsQuery {
  outcome?: PublicationOutcome;
  postId?: string;
  limit?: number;
  before?: Date;
}

export async function listPublications(query: ListPublicationsQuery = {}): Promise<Publication[]> {
  await connectDb();
  const filter: Record<string, unknown> = {};
  if (query.outcome) filter.outcome = query.outcome;
  if (query.postId) filter.postId = query.postId;
  if (query.before) filter.triggeredAt = { $lt: query.before };
  const docs = await PublicationModel.find(filter)
    .sort({ triggeredAt: -1 })
    .limit(Math.min(query.limit ?? 100, 500))
    .lean<PublicationMongoDoc[]>();
  return docs.map(toDomain);
}
