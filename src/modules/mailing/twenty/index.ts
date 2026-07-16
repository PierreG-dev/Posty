import { env } from "@/modules/shared/env";
import { HttpTwentyClient } from "./client";
import type { TwentyClient } from "./types";

export * from "./types";
export { HttpTwentyClient } from "./client";
export { MockTwentyClient } from "./mock";

/**
 * Fabrique le client Twenty depuis l'env. Renvoie `null` si la configuration
 * est absente — les routes concernées répondent alors 503, comme le pattern
 * LinkedIn (voir `src/modules/shared/env.ts`).
 */
export function twentyFromEnv(): TwentyClient | null {
  const e = env();
  if (!e.TWENTY_API_URL || !e.TWENTY_API_KEY) return null;
  return new HttpTwentyClient({ baseUrl: e.TWENTY_API_URL, token: e.TWENTY_API_KEY });
}
