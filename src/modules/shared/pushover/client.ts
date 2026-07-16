import { logger } from "@/modules/shared/logger";

export type PushoverPriority = -2 | -1 | 0 | 1 | 2;

export interface PushoverMessage {
  title?: string;
  message: string;
  priority?: PushoverPriority;
  url?: string;
  urlTitle?: string;
}

export interface PushoverConfig {
  userKey: string;
  appToken: string;
}

/**
 * Envoie une notification Pushover via un simple fetch.
 * Ne throw jamais : une notif ratée ne doit pas casser le pipeline.
 */
export async function sendPushover(cfg: PushoverConfig, msg: PushoverMessage): Promise<boolean> {
  try {
    const body = new URLSearchParams({
      token: cfg.appToken,
      user: cfg.userKey,
      message: msg.message,
      ...(msg.title ? { title: msg.title } : {}),
      ...(msg.priority !== undefined ? { priority: String(msg.priority) } : {}),
      ...(msg.url ? { url: msg.url } : {}),
      ...(msg.urlTitle ? { url_title: msg.urlTitle } : {}),
    });
    const res = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      body,
    });
    if (!res.ok) {
      logger.warn("pushover.send.failed", { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    logger.error("pushover.send.error", { err: String(err) });
    return false;
  }
}
