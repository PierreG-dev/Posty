import { DateTime } from "luxon";
import { logger } from "@/modules/shared/logger";
import { PARIS } from "@/modules/shared/luxon";
import { notify } from "@/modules/shared/pushover/notify";
import { withLock } from "@/modules/shared/locks/lock";
import { getMailSettings } from "@/modules/mailing/repositories/mail-settings-repo";
import { getMeta } from "@/modules/mailing/repositories/company-meta-repo";
import {
  claimNextPending,
  markCancelled,
  markFailed,
  markSent,
} from "@/modules/mailing/repositories/mail-queue-repo";
import {
  countSentOnParisDay,
  logSent,
  markLogImapArchived,
} from "@/modules/mailing/repositories/mail-log-repo";
import { twentyFromEnv } from "@/modules/mailing/twenty";
import type { TwentyClient } from "@/modules/mailing/twenty/types";
import type { MailSettings } from "@/modules/mailing/domain/mail-settings";
import type { MailQueueEntry } from "@/modules/mailing/domain/mail-queue";
import { createDryRunClient, createNodemailerClient, type SmtpClient } from "./smtp";
import { applyTwentyAfterSend } from "./twenty-patch-after-send";
import { createImapflowClient, type ImapClient } from "./imap";
import { buildMime } from "./mime-build";

// CDC-02 §6.2 — LA boucle d'envoi. Traitée comme le point le plus dangereux
// du projet (§ prompt étape 8) :
//   - lock global (`mail:send-tick`) : deux workers ne peuvent pas envoyer
//     en parallèle ;
//   - re-comptage du quota à chaque itération : une double exécution du job
//     ne double pas les envois ;
//   - re-vérification tardive (paused/bounce) avant l'appel SMTP ;
//   - dryRun n'appelle ni SMTP ni Twenty, mais consomme la file et journalise ;
//   - jitter entre deux envois ;
//   - échec SMTP transient = `failed` définitif + Pushover (décision §plan).

const SEND_LOCK = "mail:send-tick";
const SEND_LOCK_TTL_S = 30 * 60; // large : la boucle peut durer avec le jitter.

// Tolérance autour d'un créneau configuré (mar 10:30, jeu 14:00). Le worker
// tick à la minute ; on ne veut pas manquer parce qu'on est décalé d'une
// seconde.
const CRENAU_TOLERANCE_S = 30;

export interface SendTickDeps {
  smtp?: SmtpClient; // si absent : nodemailer (ou dryRun si settings.dryRun)
  twenty?: TwentyClient | null; // si undefined : twentyFromEnv() ; si null : skippé
  imap?: ImapClient | null; // si undefined : imapflow si configuré ; si null : archivage skippé
  now?: Date;
}

export interface SendTickResult {
  ranAt: string;
  matchedSlot: boolean;
  sent: number;
  cancelled: number;
  failed: number;
  quotaReached: boolean;
  skippedReason?: "paused" | "no_slot" | "lock_held";
}

/**
 * Point d'entrée public. Le worker appelle ceci toutes les minutes ; le
 * `matchedSlot` filtre en interne pour ne rien faire hors créneau.
 */
export async function runSendTick(deps: SendTickDeps = {}): Promise<SendTickResult> {
  const now = deps.now ?? new Date();
  const settings = await getMailSettings();

  if (settings.paused) {
    logger.info("mailing.send.paused_global");
    return skipResult(now, false, "paused");
  }
  if (!isInSendWindow(settings, now)) {
    return skipResult(now, false, "no_slot");
  }

  const outcome = await withLock(SEND_LOCK, SEND_LOCK_TTL_S, async () => {
    return runSendLoopInner(settings, deps, now);
  });
  if (outcome === null) {
    logger.info("mailing.send.lock_held");
    return skipResult(now, true, "lock_held");
  }
  return outcome;
}

/**
 * Force le déclenchement (hors créneau, sans le tick minute) — utilisé par
 * les tests. Applique `paused` et le lock, ignore la fenêtre.
 */
export async function runSendLoop(deps: SendTickDeps = {}): Promise<SendTickResult> {
  const now = deps.now ?? new Date();
  const settings = await getMailSettings();
  if (settings.paused) return skipResult(now, false, "paused");
  const outcome = await withLock(SEND_LOCK, SEND_LOCK_TTL_S, async () => {
    return runSendLoopInner(settings, deps, now);
  });
  if (outcome === null) return skipResult(now, true, "lock_held");
  return outcome;
}

async function runSendLoopInner(
  settings: MailSettings,
  deps: SendTickDeps,
  now: Date,
): Promise<SendTickResult> {
  const smtp: SmtpClient = deps.smtp ?? (settings.dryRun ? createDryRunClient() : await createNodemailerClient(settings));
  const twenty: TwentyClient | null =
    deps.twenty === null ? null : (deps.twenty ?? twentyFromEnv());
  // §7 — l'archivage IMAP est skippé en dryRun (rien n'est parti), skippé si
  // pas de host configuré, ou si l'appelant a explicitement passé `null`.
  const imap: ImapClient | null = await resolveImap(deps.imap, settings);
  // On tente de créer le dossier une fois par tick ; si l'IMAP est down,
  // on skippe l'archivage sans casser l'envoi.
  if (imap) {
    try {
      await imap.ensureFolder(settings.imap.archiveFolder);
    } catch (err) {
      logger.warn("mailing.imap.ensure_folder_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let sent = 0;
  let cancelled = 0;
  let failed = 0;
  let quotaReached = false;

  // Boucle : tant qu'il reste des `pending` et du quota, on envoie.
  // Recompter le quota à CHAQUE itération : c'est ce qui rend la boucle
  // ré-entrante face à un double appel du job.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const already = await countSentOnParisDay(now);
    if (already >= settings.dailyCap) {
      quotaReached = true;
      logger.info("mailing.send.quota_reached", { dailyCap: settings.dailyCap });
      break;
    }

    const claimed = await claimNextPending();
    if (!claimed) break;

    const outcome = await processEntry(claimed, settings, smtp, twenty, imap, now);
    if (outcome === "sent") sent++;
    else if (outcome === "cancelled") cancelled++;
    else if (outcome === "failed") failed++;

    // Jitter : entre deux envois réels (ou dryRun), on attend. Pas de jitter
    // après un cancel (rien n'est parti côté SMTP).
    if (outcome === "sent") {
      await sleep(pickJitterMs(settings));
    }
  }

  if (imap) {
    try {
      await imap.close();
    } catch {
      // ignore
    }
  }
  await maybeNotify(sent, failed, quotaReached);
  logger.info("mailing.send.done", { sent, cancelled, failed, quotaReached });
  return {
    ranAt: now.toISOString(),
    matchedSlot: true,
    sent,
    cancelled,
    failed,
    quotaReached,
  };
}

async function processEntry(
  entry: MailQueueEntry,
  settings: MailSettings,
  smtp: SmtpClient,
  twenty: TwentyClient | null,
  imap: ImapClient | null,
  _now: Date,
): Promise<"sent" | "cancelled" | "failed"> {
  // §6.2 — re-vérification tardive : le contact a peut-être été mis en
  // pause ou a bouncé entre l'enfilement et maintenant. Si oui, on annule
  // SANS consommer le quota (rien ne part côté SMTP).
  const meta = await getMeta(entry.companyId);
  if (meta?.paused) {
    await markCancelled(entry._id, "paused_before_send");
    logger.info("mailing.send.cancelled_paused", { entryId: entry._id, companyId: entry.companyId });
    return "cancelled";
  }
  if (meta?.bounce?.kind === "hard") {
    await markCancelled(entry._id, "bounce_before_send");
    return "cancelled";
  }

  const headers: Record<string, string> = {};
  if (entry.threading?.inReplyTo) headers["In-Reply-To"] = entry.threading.inReplyTo;
  if (entry.threading?.references) headers["References"] = entry.threading.references;

  const from = settings.smtp.from || settings.smtp.user || "posty@localhost";

  let messageId: string;
  const startedAt = new Date();
  try {
    const res = await smtp.send({
      from,
      to: entry.snapshot.email,
      subject: entry.subject,
      text: entry.body,
      bcc: settings.bccLogs ?? null,
      headers,
    });
    messageId = res.messageId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("mailing.send.smtp_error", { entryId: entry._id, error: msg });
    await markFailed(entry._id, msg);
    await notify(
      "Posty",
      `🚨 Envoi échoué — ${entry.snapshot.email} — ${msg.slice(0, 120)}`,
      1,
      `/mailing/queue?status=failed`,
    );
    return "failed";
  }

  const log = await logSent({
    queueId: entry._id,
    companyId: entry.companyId,
    kind: entry.kind,
    sequenceStep: entry.sequenceStep,
    campaignId: entry.campaignId,
    toEmail: entry.snapshot.email,
    subject: entry.subject,
    messageId,
    sentAt: startedAt,
    dryRun: settings.dryRun,
  });
  await markSent(entry._id, { messageId, sentAt: startedAt });

  // §7 — archivage IMAP dans le dossier « Posty » APRÈS logSent/markSent :
  // le mail EST parti. Un throw ici NE renvoie JAMAIS (critère d'accep. §7.2).
  // On flag `imapArchived=false` sur le log et on notifie ; c'est tout.
  if (imap && !settings.dryRun) {
    try {
      const mime = buildMime({
        from,
        to: entry.snapshot.email,
        subject: entry.subject,
        text: entry.body,
        messageId,
        bcc: settings.bccLogs ?? null,
        headers,
        date: startedAt,
      });
      await imap.append({
        folder: settings.imap.archiveFolder,
        raw: mime,
        flags: ["\\Seen"],
      });
      if (log && log._id) await markLogImapArchived(log._id, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("mailing.imap.archive_failed", {
        entryId: entry._id,
        error: msg,
      });
      if (log && log._id) await markLogImapArchived(log._id, false);
      await notify(
        "Posty",
        `⚠️ Mail parti, non archivé — ${entry.snapshot.email}`,
        0,
        `/mailing/log`,
      );
      // NE JAMAIS renvoyer. On continue vers le PATCH Twenty.
    }
  }

  // §6.2 — PATCH Twenty UNIQUEMENT pour les séquences, uniquement hors
  // dryRun. Les campagnes ne touchent pas aux champs de séquence.
  if (
    entry.kind === "sequence" &&
    entry.sequenceStep !== null &&
    !settings.dryRun &&
    twenty !== null
  ) {
    try {
      const company = await twenty.getCompany(entry.companyId);
      if (company) {
        await applyTwentyAfterSend(twenty, {
          company,
          step: entry.sequenceStep as 0 | 1 | 2,
          messageId,
          sentAt: startedAt,
          settings,
        });
      } else {
        logger.warn("mailing.send.twenty_missing", { companyId: entry.companyId });
      }
    } catch (err) {
      // Le mail EST parti. Un échec de PATCH n'annule pas l'envoi ; on
      // notifie (on ne veut pas laisser filer une désynchro silencieuse).
      logger.error("mailing.send.twenty_patch_failed", {
        entryId: entry._id,
        error: err instanceof Error ? err.message : String(err),
      });
      await notify(
        "Posty",
        `⚠️ Mail parti, PATCH Twenty échoué — ${entry.snapshot.email}`,
        0,
        `/mailing/queue`,
      );
    }
  }

  return "sent";
}

function isInSendWindow(settings: MailSettings, now: Date): boolean {
  const nowP = DateTime.fromJSDate(now).setZone(PARIS);
  const dow = nowP.weekday; // 1=lundi, 7=dimanche
  for (const slot of settings.sendDays) {
    if (slot.dayOfWeek !== dow) continue;
    const [hStr, mStr] = slot.time.split(":");
    const h = Number(hStr);
    const m = Number(mStr);
    const target = nowP.set({ hour: h, minute: m, second: 0, millisecond: 0 });
    const diffS = Math.abs(nowP.toSeconds() - target.toSeconds());
    if (diffS <= CRENAU_TOLERANCE_S) return true;
  }
  return false;
}

function pickJitterMs(settings: MailSettings): number {
  const min = Math.max(0, settings.jitter.minSeconds);
  const max = Math.max(min, settings.jitter.maxSeconds);
  const s = Math.floor(min + Math.random() * (max - min + 1));
  return s * 1000;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

async function maybeNotify(sent: number, failed: number, quota: boolean): Promise<void> {
  if (failed > 0) return; // déjà notifié entrée par entrée
  if (sent === 0 && !quota) return;
  const q = quota ? " — quota atteint" : "";
  await notify("Posty", `📬 ${sent} mail(s) envoyé(s)${q}`, 0, `/mailing`);
}

function skipResult(
  now: Date,
  matched: boolean,
  reason: "paused" | "no_slot" | "lock_held",
): SendTickResult {
  return {
    ranAt: now.toISOString(),
    matchedSlot: matched,
    sent: 0,
    cancelled: 0,
    failed: 0,
    quotaReached: false,
    skippedReason: reason,
  };
}

async function resolveImap(
  supplied: ImapClient | null | undefined,
  settings: MailSettings,
): Promise<ImapClient | null> {
  if (supplied === null) return null;
  if (supplied) return supplied;
  // Défaut : jamais d'archivage en dryRun (aucun mail réel), jamais si le
  // host n'est pas configuré (env vide en dev/test).
  if (settings.dryRun) return null;
  if (!settings.imap.host) return null;
  try {
    return await createImapflowClient(settings);
  } catch (err) {
    logger.error("mailing.imap.connect_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// Export pour tests unitaires du helper (fuseau horaire notamment).
export { isInSendWindow };
