import { logger } from "@/modules/shared/logger";
import { runImapInspect } from "@/modules/mailing/services/imap-inspect-tick";

// Wrapper worker — quotidien, à 7 h Paris (1h après l'éligibilité pour ne
// pas croiser les jobs).
export async function mailingImapInspectJob(): Promise<void> {
  try {
    const r = await runImapInspect();
    logger.info("worker.mailing.imap.done", { ...r });
  } catch (err) {
    logger.error("worker.mailing.imap.error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
