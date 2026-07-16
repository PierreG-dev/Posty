import { env } from "@/modules/shared/env";
import { getSettings } from "@/modules/shared/settings/repo";
import { sendPushover, type PushoverPriority } from "./client";

/**
 * Envoie une Pushover si la config est présente et activée. Ne throw jamais :
 * une notif ratée ne casse pas le pipeline. Le chemin relatif est concaténé
 * à APP_URL pour donner un lien direct vers la page concernée (§11).
 */
export async function notify(
  title: string,
  message: string,
  priority: PushoverPriority,
  urlPath?: string,
): Promise<void> {
  const s = await getSettings();
  if (!s.pushover?.enabled || !s.pushover.userKey || !s.pushover.appToken) return;
  await sendPushover(
    { userKey: s.pushover.userKey, appToken: s.pushover.appToken },
    {
      title,
      message,
      priority,
      ...(urlPath ? { url: `${env().APP_URL}${urlPath}`, urlTitle: "Ouvrir" } : {}),
    },
  );
}
