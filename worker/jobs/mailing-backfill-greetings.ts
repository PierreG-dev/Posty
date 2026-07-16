import { logger } from "@/modules/shared/logger";
import { backfillGreetings } from "@/modules/mailing/services/greeting";

// Job de rattrapage §6.1 : remplit les salutations manquantes en dehors de
// toute boucle d'envoi. Wire différé depuis l'étape 7 (fonction exportée,
// non planifiée).
export async function mailingBackfillGreetingsJob(): Promise<void> {
  try {
    const res = await backfillGreetings();
    logger.info("worker.mail.backfill.done", { ...res });
  } catch (err) {
    logger.error("worker.mail.backfill.error", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
