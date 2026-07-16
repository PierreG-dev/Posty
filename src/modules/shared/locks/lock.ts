import { randomUUID } from "node:crypto";
import { connectDb } from "@/modules/shared/db/mongoose";
import { LockModel } from "./model";

/**
 * Tente d'acquérir un verrou nommé. Renvoie l'ID du détenteur si obtenu,
 * `null` si un autre process le tient déjà.
 *
 * L'index TTL sur `expiresAt` garantit la libération automatique en cas de crash.
 */
export async function acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
  await connectDb();
  const holder = randomUUID();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  try {
    await LockModel.create({ _id: key, holder, expiresAt });
    return holder;
  } catch (err) {
    // E11000 : verrou déjà pris
    if (isDuplicateKeyError(err)) return null;
    throw err;
  }
}

/** Libère un verrou uniquement si on est bien le détenteur. */
export async function releaseLock(key: string, holder: string): Promise<void> {
  await connectDb();
  await LockModel.deleteOne({ _id: key, holder });
}

/** Exécute `fn` sous verrou. Renvoie `null` si le verrou n'a pas pu être pris. */
export async function withLock<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const holder = await acquireLock(key, ttlSeconds);
  if (!holder) return null;
  try {
    return await fn();
  } finally {
    await releaseLock(key, holder);
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: number; codeName?: string };
  return e.code === 11000 || e.codeName === "DuplicateKey";
}
