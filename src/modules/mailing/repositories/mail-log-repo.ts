import { connectDb } from "@/modules/shared/db/mongoose";
import { DateTime } from "luxon";
import { PARIS } from "@/modules/shared/luxon";
import type { MailLogEntry } from "@/modules/mailing/domain/mail-log";
import { MailLogModel, type MailLogMongoDoc } from "./mail-log-model";

function toDomain(doc: MailLogMongoDoc): MailLogEntry {
  return {
    _id: String(doc._id),
    queueId: doc.queueId,
    companyId: doc.companyId,
    kind: doc.kind as "sequence" | "campaign",
    sequenceStep: doc.sequenceStep ?? null,
    campaignId: doc.campaignId ?? null,
    toEmail: doc.toEmail,
    subject: doc.subject,
    messageId: doc.messageId,
    sentAt: doc.sentAt,
    dryRun: doc.dryRun,
    imapArchived: doc.imapArchived ?? false,
  };
}

export interface LogSentInput {
  queueId: string;
  companyId: string;
  kind: "sequence" | "campaign";
  sequenceStep: number | null;
  campaignId: string | null;
  toEmail: string;
  subject: string;
  messageId: string;
  sentAt: Date;
  dryRun: boolean;
}

export async function logSent(input: LogSentInput): Promise<MailLogEntry> {
  await connectDb();
  const doc = await MailLogModel.create(input);
  return toDomain(doc.toObject() as MailLogMongoDoc);
}

/**
 * Marque un envoi comme archivé (ou non) côté IMAP. §7.2 : un échec
 * d'archivage n'annule PAS l'envoi ; on flag `imapArchived=false` et on
 * notifie, mais le mail_log reste. Cette méthode est appelée par la boucle
 * d'envoi APRÈS la tentative d'APPEND, jamais avant.
 */
export async function markLogImapArchived(logId: string, archived: boolean): Promise<void> {
  await connectDb();
  await MailLogModel.updateOne({ _id: logId }, { $set: { imapArchived: archived } });
}

/**
 * Recherche le dernier envoi Posty à destination d'un email — utilisé par le
 * scan bounces pour retrouver le contact concerné à partir de l'adresse
 * extraite du DSN. On ignore les dryRun (ils n'ont pas d'existence côté SMTP).
 */
export async function findLastLogByEmail(email: string): Promise<MailLogEntry | null> {
  await connectDb();
  const doc = await MailLogModel.findOne({ toEmail: email.toLowerCase(), dryRun: false })
    .sort({ sentAt: -1 })
    .lean<MailLogMongoDoc>();
  return doc ? toDomain(doc) : null;
}

/**
 * Recherche un envoi Posty par messageId — utilisé par le scan des réponses
 * pour attribuer un message entrant à un contact via In-Reply-To/References.
 */
export async function findLogByMessageId(messageId: string): Promise<MailLogEntry | null> {
  await connectDb();
  const doc = await MailLogModel.findOne({ messageId })
    .lean<MailLogMongoDoc>();
  return doc ? toDomain(doc) : null;
}

export async function findAnyLogByMessageIds(messageIds: readonly string[]): Promise<MailLogEntry | null> {
  await connectDb();
  if (messageIds.length === 0) return null;
  const doc = await MailLogModel.findOne({ messageId: { $in: [...messageIds] } })
    .lean<MailLogMongoDoc>();
  return doc ? toDomain(doc) : null;
}

/**
 * Compte les envois réellement partis (dryRun exclus) sur la journée Paris
 * qui contient `at`. C'est la source du quota §6.2 : elle doit rester
 * cohérente même sur double exécution du job.
 */
export async function countSentOnParisDay(at: Date): Promise<number> {
  await connectDb();
  const start = DateTime.fromJSDate(at).setZone(PARIS).startOf("day");
  const end = start.plus({ days: 1 });
  return MailLogModel.countDocuments({
    dryRun: false,
    sentAt: { $gte: start.toJSDate(), $lt: end.toJSDate() },
  });
}

export interface DailyBreakdown {
  total: number;
  byPriority: { p1: number; p2: number; p3: number };
}

/** Ventilation du quota consommé aujourd'hui, pour l'affichage dashboard. */
export async function countBreakdownOnParisDay(at: Date): Promise<DailyBreakdown> {
  await connectDb();
  const start = DateTime.fromJSDate(at).setZone(PARIS).startOf("day");
  const end = start.plus({ days: 1 });
  const rows = await MailLogModel.aggregate<{ _id: number | null; count: number }>([
    { $match: { dryRun: false, sentAt: { $gte: start.toJSDate(), $lt: end.toJSDate() } } },
    {
      $group: {
        _id: {
          $cond: [
            { $eq: ["$kind", "campaign"] },
            3,
            { $cond: [{ $eq: ["$sequenceStep", 0] }, 2, 1] },
          ],
        },
        count: { $sum: 1 },
      },
    },
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
