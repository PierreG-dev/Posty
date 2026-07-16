import { logger } from "@/modules/shared/logger";
import { runSchedulerTick } from "@/modules/linkedin/services/scheduler-tick";

/** Tick minute : slots dus + one-shots dus. */
export async function publishTick(now: Date = new Date()): Promise<void> {
  try {
    const r = await runSchedulerTick(now);
    if (r.dueSlots || r.dueOneShots || r.missed) {
      logger.info("worker.publish_tick", r);
    }
  } catch (err) {
    logger.error("worker.publish_tick.error", { err: String(err) });
  }
}
