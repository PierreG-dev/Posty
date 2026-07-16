import { logger } from "@/modules/shared/logger";
import { PostsApiClient } from "@/modules/linkedin/linkedin-api";
import { refreshIfNeeded } from "@/modules/linkedin/services/token-refresh";

/**
 * §10.3 — job quotidien. Rafraîchit l'access token s'il expire dans < 7 j,
 * et notifie via Pushover si le refresh token expire dans < 14 j.
 */
export async function refreshTokenJob(now: Date = new Date()): Promise<void> {
  try {
    const client = new PostsApiClient();
    const r = await refreshIfNeeded(client, now);
    logger.info("worker.refresh_token", { status: r.status });
  } catch (err) {
    logger.error("worker.refresh_token.error", { err: String(err) });
  }
}
