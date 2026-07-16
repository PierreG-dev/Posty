import cron from "node-cron";
import { connectDb } from "@/modules/shared/db/mongoose";
import { withLock } from "@/modules/shared/locks/lock";
import { logger } from "@/modules/shared/logger";
import { nowParis } from "@/modules/shared/luxon";
import { publishTick } from "./jobs/publish-tick";
import { refreshTokenJob } from "./jobs/refresh-token";
import { mailingEligibilityJob } from "./jobs/mailing-eligibility";
import { mailingSendTickJob } from "./jobs/mailing-send";
import { mailingBackfillGreetingsJob } from "./jobs/mailing-backfill-greetings";
import { mailingImapInspectJob } from "./jobs/mailing-imap-inspect";

const TICK_LOCK = "tick";
const TICK_TTL_S = 55;
const REFRESH_LOCK = "refresh-token";
const REFRESH_TTL_S = 5 * 60;
const MAIL_ELIGIBILITY_LOCK = "mail:eligibility";
const MAIL_ELIGIBILITY_TTL_S = 15 * 60;
const MAIL_BACKFILL_LOCK = "mail:backfill-greetings";
const MAIL_BACKFILL_TTL_S = 15 * 60;
const MAIL_IMAP_LOCK = "mail:imap-inspect";
const MAIL_IMAP_TTL_S = 15 * 60;

async function tick(): Promise<void> {
  const result = await withLock(TICK_LOCK, TICK_TTL_S, async () => {
    const now = new Date();
    logger.debug("worker.tick", { now: nowParis().toFormat("yyyy-LL-dd HH:mm:ss") });
    await publishTick(now);
    // §6.2 CDC-02 — le mailing send-tick fait son propre filtrage horaire et
    // son propre verrou. On le déclenche à chaque minute ; il est no-op hors
    // fenêtre.
    await mailingSendTickJob(now);
    return true;
  });
  if (result === null) {
    logger.debug("worker.tick.skipped", { reason: "lock held by another process" });
  }
}

async function dailyRefresh(): Promise<void> {
  const r = await withLock(REFRESH_LOCK, REFRESH_TTL_S, async () => {
    await refreshTokenJob(new Date());
    return true;
  });
  if (r === null) logger.debug("worker.refresh.skipped", { reason: "lock held" });
}

async function dailyMailEligibility(): Promise<void> {
  const r = await withLock(MAIL_ELIGIBILITY_LOCK, MAIL_ELIGIBILITY_TTL_S, async () => {
    await mailingEligibilityJob(new Date());
    return true;
  });
  if (r === null) logger.debug("worker.mail.eligibility.skipped", { reason: "lock held" });
}

async function dailyMailBackfill(): Promise<void> {
  const r = await withLock(MAIL_BACKFILL_LOCK, MAIL_BACKFILL_TTL_S, async () => {
    await mailingBackfillGreetingsJob();
    return true;
  });
  if (r === null) logger.debug("worker.mail.backfill.skipped", { reason: "lock held" });
}

async function dailyMailImapInspect(): Promise<void> {
  const r = await withLock(MAIL_IMAP_LOCK, MAIL_IMAP_TTL_S, async () => {
    await mailingImapInspectJob();
    return true;
  });
  if (r === null) logger.debug("worker.mail.imap.skipped", { reason: "lock held" });
}

async function main(): Promise<void> {
  await connectDb();
  logger.info("worker.boot", {
    tz: process.env.TZ ?? "unset",
    nodeVersion: process.version,
  });

  // Tick minute (§7.1). Le calendrier interne (Luxon) est ancré Paris, quel
  // que soit le TZ du conteneur.
  cron.schedule("* * * * *", () => {
    void tick().catch((err) => logger.error("worker.tick.error", { err: String(err) }));
  });

  // Refresh token quotidien à 4:00 heure de Paris (§10.3).
  cron.schedule(
    "0 4 * * *",
    () => {
      void dailyRefresh().catch((err) => logger.error("worker.refresh.error", { err: String(err) }));
    },
    { timezone: "Europe/Paris" },
  );

  // Backfill des salutations à 5:00 Paris (§6.1 CDC-02, hors boucle d'envoi).
  cron.schedule(
    "0 5 * * *",
    () => {
      void dailyMailBackfill().catch((err) =>
        logger.error("worker.mail.backfill.error", { err: String(err) }),
      );
    },
    { timezone: "Europe/Paris" },
  );

  // Éligibilité mailing à 6:00 Paris (§5 CDC-02).
  cron.schedule(
    "0 6 * * *",
    () => {
      void dailyMailEligibility().catch((err) =>
        logger.error("worker.mail.eligibility.error", { err: String(err) }),
      );
    },
    { timezone: "Europe/Paris" },
  );

  // Inspection IMAP à 7:00 Paris (§8 CDC-02) — bounces + réponses. Décalé
  // d'1h après l'éligibilité pour ne pas se croiser.
  cron.schedule(
    "0 7 * * *",
    () => {
      void dailyMailImapInspect().catch((err) =>
        logger.error("worker.mail.imap.error", { err: String(err) }),
      );
    },
    { timezone: "Europe/Paris" },
  );

  // Un tick immédiat au démarrage pour visibilité.
  await tick();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
