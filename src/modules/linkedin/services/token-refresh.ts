import { logger } from "@/modules/shared/logger";
import { sendPushover } from "@/modules/shared/pushover/client";
import { env } from "@/modules/shared/env";
import {
  getLinkedInCredentials,
  getSettings,
  saveLinkedInCredentials,
  type LinkedInCredentials,
} from "@/modules/shared/settings/repo";
import type { LinkedInClient } from "@/modules/linkedin/linkedin-api";

const ACCESS_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;   // 7 jours
const REFRESH_WARN_MS = 14 * 24 * 60 * 60 * 1000;   // 14 jours (Pushover)

export interface RefreshOutcome {
  status: "not_connected" | "still_valid" | "refreshed" | "reconnect_required";
  credentials: LinkedInCredentials | null;
}

/**
 * Rafraîchit le token LinkedIn si nécessaire (§10.3). Idempotent, safe à
 * appeler à chaque publication (le publisher passe par ici en cas de 401).
 * Émet un Pushover si le refresh_token approche de son expiration.
 */
export async function refreshIfNeeded(client: LinkedInClient, now: Date = new Date()): Promise<RefreshOutcome> {
  const creds = await getLinkedInCredentials();
  if (!creds) return { status: "not_connected", credentials: null };

  const accessRemaining = creds.expiresAt.getTime() - now.getTime();
  const refreshRemaining = creds.refreshExpiresAt.getTime() - now.getTime();

  if (refreshRemaining <= 0) {
    await notifyReconnectRequired(creds.refreshExpiresAt);
    return { status: "reconnect_required", credentials: null };
  }
  if (refreshRemaining < REFRESH_WARN_MS) {
    await notifyReconnectRequired(creds.refreshExpiresAt);
  }

  if (accessRemaining > ACCESS_MARGIN_MS) {
    return { status: "still_valid", credentials: creds };
  }

  return { status: "refreshed", credentials: await forceRefresh(client, creds, now) };
}

/** Force un refresh (utilisé après un 401 en cours de publication). */
export async function forceRefresh(
  client: LinkedInClient,
  creds: LinkedInCredentials,
  now: Date = new Date(),
): Promise<LinkedInCredentials> {
  const res = await client.refreshAccessToken(creds.refreshToken);
  const next: LinkedInCredentials = {
    authorUrn: creds.authorUrn,
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    expiresAt: new Date(now.getTime() + res.expiresInSec * 1000),
    refreshExpiresAt: new Date(now.getTime() + res.refreshExpiresInSec * 1000),
  };
  await saveLinkedInCredentials(next);
  logger.info("linkedin.token.refreshed", {
    expiresAt: next.expiresAt.toISOString(),
    refreshExpiresAt: next.refreshExpiresAt.toISOString(),
  });
  return next;
}

async function notifyReconnectRequired(refreshExpiresAt: Date): Promise<void> {
  const s = await getSettings();
  if (!s.pushover?.enabled || !s.pushover.userKey || !s.pushover.appToken) return;
  const dateStr = refreshExpiresAt.toISOString().slice(0, 10);
  await sendPushover(
    { userKey: s.pushover.userKey, appToken: s.pushover.appToken },
    {
      title: "Posty",
      message: `⚠️ Reconnexion LinkedIn requise avant le ${dateStr}`,
      priority: 1,
      url: `${env().APP_URL}/settings`,
      urlTitle: "Reconnecter LinkedIn",
    },
  );
}
