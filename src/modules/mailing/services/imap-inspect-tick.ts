import { logger } from "@/modules/shared/logger";
import { notify } from "@/modules/shared/pushover/notify";
import { getMailSettings } from "@/modules/mailing/repositories/mail-settings-repo";
import {
  getMeta,
  setBounce,
  setPaused,
} from "@/modules/mailing/repositories/company-meta-repo";
import { cancelPendingForCompany } from "@/modules/mailing/repositories/mail-queue-repo";
import {
  findAnyLogByMessageIds,
  findLastLogByEmail,
} from "@/modules/mailing/repositories/mail-log-repo";
import {
  getFolderState,
  reconcileFolder,
  setFolderLastUid,
} from "@/modules/mailing/repositories/mail-imap-state-repo";
import { twentyFromEnv } from "@/modules/mailing/twenty";
import type { TwentyClient } from "@/modules/mailing/twenty/types";
import type { ImapClient, ImapMessage } from "./imap";
import { createImapflowClient } from "./imap";
import { isDsnMessage, parseDsn } from "./dsn-parse";

// CDC-02 §8 — job d'inspection IMAP. Une seule connexion, deux traitements
// séquentiels : bounces, puis réponses. Scanne INBOX + Spam (§15 point ouvert
// 4 clos par réponse utilisateur : scanner les deux).
//
// Watermark UID par dossier (mail_imap_state) — pas de \Seen, pas de move,
// l'INBOX reste intacte (réponse utilisateur au plan).
//
// Ordre volontaire : DSN d'abord (un bounce peut aussi être vu comme un
// message entrant si mal détecté ; on l'écarte du chemin "réponse" en le
// traitant en premier + en filtrant le multipart/report côté réponses).

const SOFT_BOUNCE_THRESHOLD = 3;

export interface InspectResult {
  bouncesHard: number;
  bouncesSoft: number;
  replies: number;
  scanned: number;
  errors: number;
}

export interface InspectDeps {
  imap?: ImapClient | null;
  twenty?: TwentyClient | null;
}

export async function runImapInspect(deps: InspectDeps = {}): Promise<InspectResult> {
  const settings = await getMailSettings();
  if (!settings.imap.host && !deps.imap) {
    logger.warn("mailing.imap.inspect.no_host");
    return { bouncesHard: 0, bouncesSoft: 0, replies: 0, scanned: 0, errors: 0 };
  }
  const imap: ImapClient =
    deps.imap ?? (await createImapflowClient(settings));
  const twenty: TwentyClient | null =
    deps.twenty === null ? null : (deps.twenty ?? twentyFromEnv());

  const acc: InspectResult = { bouncesHard: 0, bouncesSoft: 0, replies: 0, scanned: 0, errors: 0 };

  const folders = [settings.imap.inboxFolder, settings.imap.spamFolder]
    .filter((f): f is string => !!f && f.length > 0);

  try {
    for (const folder of folders) {
      try {
        await inspectFolder(folder, imap, twenty, settings.smtp.from, acc);
      } catch (err) {
        acc.errors++;
        logger.warn("mailing.imap.inspect.folder_error", {
          folder,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    if (!deps.imap) {
      try {
        await imap.close();
      } catch {
        // ignore
      }
    }
  }

  logger.info("mailing.imap.inspect.done", { ...acc });
  return acc;
}

async function inspectFolder(
  folder: string,
  imap: ImapClient,
  twenty: TwentyClient | null,
  ownEmail: string,
  acc: InspectResult,
): Promise<void> {
  const fetched = await imap.fetchNewMessages({ folder, sinceUid: 0 });
  await reconcileFolder(folder, fetched.uidValidity);
  const state = await getFolderState(folder);
  const sinceUid = state?.lastUid ?? 0;
  const fresh = fetched.messages.filter((m) => m.uid > sinceUid);
  acc.scanned += fresh.length;

  let maxUid = sinceUid;
  const ownAddr = (ownEmail || "").toLowerCase();

  for (const msg of fresh) {
    try {
      if (isDsnMessage(msg)) {
        const changed = await handleBounce(msg, twenty);
        if (changed === "hard") acc.bouncesHard++;
        else if (changed === "soft") acc.bouncesSoft++;
      } else if (msg.from && msg.from !== ownAddr) {
        const isReply = await handleReply(msg);
        if (isReply) acc.replies++;
      }
    } catch (err) {
      acc.errors++;
      logger.warn("mailing.imap.inspect.msg_error", {
        uid: msg.uid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (msg.uid > maxUid) maxUid = msg.uid;
  }

  if (maxUid > sinceUid) {
    await setFolderLastUid(folder, maxUid);
  }
}

// ─── Bounces ────────────────────────────────────────────────────────────────

async function handleBounce(
  msg: ImapMessage,
  twenty: TwentyClient | null,
): Promise<"hard" | "soft" | null> {
  const parsed = parseDsn(msg);
  if (!parsed) {
    logger.warn("mailing.imap.dsn_unparsed", { uid: msg.uid });
    return null;
  }
  const log = await findLastLogByEmail(parsed.email);
  if (!log) {
    logger.info("mailing.imap.bounce_unknown_email", { email: parsed.email });
    return null;
  }
  const companyId = log.companyId;
  const existing = await getMeta(companyId);
  const currentCount = existing?.bounce?.kind === "soft" ? existing.bounce.count : 0;

  if (parsed.kind === "hard") {
    await applyHardBounce(companyId, parsed.status, twenty);
    await notify(
      "Posty",
      `🚨 Hard bounce — ${log.toEmail} (${parsed.status}) — sorti de l'auto`,
      1,
      `/mailing/log`,
    );
    return "hard";
  }

  // Soft
  const nextCount = currentCount + 1;
  if (nextCount >= SOFT_BOUNCE_THRESHOLD) {
    await applyHardBounce(companyId, parsed.status, twenty);
    await notify(
      "Posty",
      `🚨 3× soft bounce (${parsed.status}) — ${log.toEmail} — sorti de l'auto`,
      1,
      `/mailing/log`,
    );
    return "hard";
  }
  await setBounce(companyId, {
    kind: "soft",
    count: nextCount,
    lastAt: new Date(),
    lastCode: parsed.status,
  });
  return "soft";
}

async function applyHardBounce(
  companyId: string,
  code: string,
  twenty: TwentyClient | null,
): Promise<void> {
  await setBounce(companyId, {
    kind: "hard",
    count: 1,
    lastAt: new Date(),
    lastCode: code,
  });
  await cancelPendingForCompany(companyId, "hard_bounce");
  if (twenty) {
    try {
      await twenty.patchCompany(companyId, { isAutoHandled: false });
    } catch (err) {
      logger.error("mailing.imap.twenty_kill_switch_failed", {
        companyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ─── Réponses ───────────────────────────────────────────────────────────────

async function handleReply(msg: ImapMessage): Promise<boolean> {
  // §8.2 — un message est une réponse si :
  //  - son In-Reply-To OU une entrée de son References correspond à un
  //    messageId Posty (mail_log), OU
  //  - à défaut, son From correspond à l'email d'un contact à qui Posty a
  //    déjà envoyé.
  const candidates: string[] = [];
  if (msg.inReplyTo) candidates.push(msg.inReplyTo);
  for (const r of msg.references) candidates.push(r);

  let log = candidates.length > 0 ? await findAnyLogByMessageIds(candidates) : null;
  if (!log && msg.from) {
    log = await findLastLogByEmail(msg.from);
  }
  if (!log) return false;

  const companyId = log.companyId;
  const meta = await getMeta(companyId);
  // Idempotence : si le contact est déjà en pause 'reply', on ne re-notifie
  // pas (le message a probablement été déjà traité manuellement mais on n'a
  // pas remis le watermark — ou re-scan post-reset UIDVALIDITY).
  if (meta?.paused && meta.pausedReason === "reply") return false;

  await setPaused(companyId, true, "reply");
  await cancelPendingForCompany(companyId, "reply");
  await notify(
    "Posty",
    `💬 ${log.toEmail} a répondu — à traiter`,
    1,
    `/mailing/inbox`,
  );
  logger.info("mailing.imap.reply_detected", { companyId, from: msg.from });
  return true;
}
