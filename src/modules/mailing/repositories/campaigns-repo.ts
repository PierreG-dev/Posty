import { Types } from "mongoose";
import { connectDb } from "@/modules/shared/db/mongoose";
import {
  campaignInputSchema,
  EMPTY_STATS,
  type Campaign,
  type CampaignInput,
  type CampaignStats,
  type CampaignStatus,
  type CampaignEnqueueReport,
} from "@/modules/mailing/domain/campaigns";
import { CampaignModel, type CampaignMongoDoc } from "./campaigns-model";
import { MailQueueModel } from "./mail-queue-model";
import { MailLogModel } from "./mail-log-model";

function toDomain(doc: CampaignMongoDoc): Campaign {
  return {
    _id: String(doc._id),
    name: doc.name,
    subject: doc.subject,
    body: doc.body,
    blockIds: (doc.blockIds ?? []).map(String),
    targetCompanyIds: (doc.targetCompanyIds ?? []).map(String),
    status: doc.status as CampaignStatus,
    stats: {
      total: doc.stats?.total ?? 0,
      enqueued: doc.stats?.enqueued ?? 0,
      sent: doc.stats?.sent ?? 0,
      failed: doc.stats?.failed ?? 0,
      cancelled: doc.stats?.cancelled ?? 0,
    },
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    queuedAt: doc.queuedAt ?? null,
    completedAt: doc.completedAt ?? null,
    enqueueReport: doc.enqueueReport
      ? {
          candidates: doc.enqueueReport.candidates,
          enqueued: doc.enqueueReport.enqueued,
          duplicates: doc.enqueueReport.duplicates,
          noEmail: doc.enqueueReport.noEmail,
          ineligible: doc.enqueueReport.ineligible,
          errors: doc.enqueueReport.errors,
          at: doc.enqueueReport.at,
        }
      : null,
  };
}

export async function setCampaignEnqueueReport(
  id: string,
  report: CampaignEnqueueReport,
): Promise<void> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return;
  await CampaignModel.updateOne({ _id: id }, { $set: { enqueueReport: report } });
}

export async function listCampaigns(): Promise<Campaign[]> {
  await connectDb();
  const docs = await CampaignModel.find().sort({ createdAt: -1 }).lean<CampaignMongoDoc[]>();
  return docs.map(toDomain);
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return null;
  const doc = await CampaignModel.findById(id).lean<CampaignMongoDoc>();
  return doc ? toDomain(doc) : null;
}

export async function createCampaign(input: CampaignInput): Promise<Campaign> {
  await connectDb();
  const parsed = campaignInputSchema.parse(input);
  const created = await CampaignModel.create({
    ...parsed,
    status: "draft",
    stats: EMPTY_STATS,
  });
  return toDomain(created.toObject() as CampaignMongoDoc);
}

/**
 * Édition — autorisée UNIQUEMENT en `draft`. Une fois `queued`, une campagne
 * est immuable ; seule l'action « Annuler » reste possible. C'est la décision
 * du point ouvert 1 du plan.
 */
export async function updateCampaignDraft(
  id: string,
  patch: Partial<CampaignInput>,
): Promise<Campaign | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return null;
  const parsed = campaignInputSchema.partial().parse(patch);
  const doc = await CampaignModel.findOneAndUpdate(
    { _id: id, status: "draft" },
    { $set: parsed },
    { new: true },
  ).lean<CampaignMongoDoc>();
  return doc ? toDomain(doc) : null;
}

export async function deleteCampaignDraft(id: string): Promise<boolean> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return false;
  const r = await CampaignModel.deleteOne({ _id: id, status: "draft" });
  return r.deletedCount === 1;
}

export async function setCampaignStatus(
  id: string,
  status: CampaignStatus,
  extras: { queuedAt?: Date; completedAt?: Date; stats?: CampaignStats } = {},
): Promise<Campaign | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return null;
  const set: Record<string, unknown> = { status };
  if (extras.queuedAt) set.queuedAt = extras.queuedAt;
  if (extras.completedAt) set.completedAt = extras.completedAt;
  if (extras.stats) set.stats = extras.stats;
  const doc = await CampaignModel.findByIdAndUpdate(id, { $set: set }, { new: true }).lean<CampaignMongoDoc>();
  return doc ? toDomain(doc) : null;
}

/**
 * Recalcule les stats depuis mail_queue + mail_log. Source de vérité :
 * mail_queue pour l'état courant (pending/sent/failed/cancelled), mail_log
 * pour un compte robuste des envois réels.
 */
export async function refreshCampaignStats(id: string): Promise<CampaignStats | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return null;

  const [queueRows, logCount] = await Promise.all([
    MailQueueModel.aggregate<{ _id: string; count: number }>([
      { $match: { kind: "campaign", campaignId: id } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    MailLogModel.countDocuments({ kind: "campaign", campaignId: id, dryRun: false }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of queueRows) byStatus[r._id] = r.count;

  const stats: CampaignStats = {
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    enqueued: byStatus.pending ?? 0,
    sent: logCount,
    failed: byStatus.failed ?? 0,
    cancelled: byStatus.cancelled ?? 0,
  };
  await CampaignModel.updateOne({ _id: id }, { $set: { stats } });
  return stats;
}

/**
 * Liste des companyId qui ont DÉJÀ reçu (ou sont en file pour) cette campagne.
 * Utilisé par l'audience pour appliquer l'exclusion `already_received`.
 * On agrège log (envois réels) + queue non-cancelled (envois programmés).
 */
export async function findCampaignRecipientIds(campaignId: string): Promise<Set<string>> {
  await connectDb();
  const [logs, queued] = await Promise.all([
    MailLogModel.distinct("companyId", {
      kind: "campaign",
      campaignId,
      dryRun: false,
    }),
    MailQueueModel.distinct("companyId", {
      kind: "campaign",
      campaignId,
      status: { $ne: "cancelled" },
    }),
  ]);
  return new Set<string>([...logs.map(String), ...queued.map(String)]);
}

/**
 * Annule les entrées `pending` restantes d'une campagne — action « Annuler ».
 * Ne touche pas aux entrées `sending` : elles sont réclamées par un sender et
 * le mail va partir (ou vient de partir). Ne touche pas non plus aux entrées
 * `sent`/`failed`, elles sont déjà terminales.
 */
export async function cancelPendingForCampaign(campaignId: string): Promise<number> {
  await connectDb();
  const r = await MailQueueModel.updateMany(
    { kind: "campaign", campaignId, status: "pending" },
    { $set: { status: "cancelled", cancelReason: "campaign_cancelled" } },
  );
  return r.modifiedCount ?? 0;
}
