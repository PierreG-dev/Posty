import { logger } from "@/modules/shared/logger";
import { runEligibilityTick } from "@/modules/mailing/services/eligibility-tick";

export async function mailingEligibilityJob(now: Date): Promise<void> {
  try {
    const res = await runEligibilityTick({ now });
    logger.info("worker.mail.eligibility.done", { ...res });
  } catch (err) {
    logger.error("worker.mail.eligibility.error", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
