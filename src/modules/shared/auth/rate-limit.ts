// Sliding window in-memory. Suffisant pour l'app mono-utilisateur :
// une seule instance web derrière Coolify, un seul acteur (moi).
// Si un jour on scale à plusieurs replicas, le compteur devra migrer
// dans Mongo — c'est documenté dans CLAUDE.md.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

interface Bucket {
  attempts: number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const bucket = buckets.get(key) ?? { attempts: [] };

  bucket.attempts = bucket.attempts.filter((t) => t > cutoff);

  if (bucket.attempts.length >= MAX_ATTEMPTS) {
    const oldest = bucket.attempts[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  bucket.attempts.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: MAX_ATTEMPTS - bucket.attempts.length, retryAfterSec: 0 };
}

/** Utilisé en test uniquement. */
export function resetRateLimit(): void {
  buckets.clear();
}
