import { logger } from "@/modules/shared/logger";
import { runSendTick } from "@/modules/mailing/services/send-tick";

// Tick minute — `runSendTick` filtre en interne (isInSendWindow). Cette
// fine-tuning est déportée dans le service pour rester testable indépendamment
// du planificateur cron.
export async function mailingSendTickJob(now: Date): Promise<void> {
  try {
    const res = await runSendTick({ now });
    if (res.matchedSlot) logger.info("worker.mail.send.tick", { ...res });
  } catch (err) {
    logger.error("worker.mail.send.error", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
