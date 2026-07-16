import argon2 from "argon2";
import { env } from "@/modules/shared/env";

/**
 * Le hash argon2id est stocké BASE64-WRAPPÉ dans `AUTH_PASSWORD_HASH` afin
 * d'éviter les `$` du format PHC qui cassent l'interpolation shell/docker.
 * Ici on décode avant de passer à argon2.verify.
 */
function decodedHash(): string {
  const raw = env().AUTH_PASSWORD_HASH.trim();
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    if (!decoded.startsWith("$argon2")) {
      throw new Error("Décodage OK mais pas un hash argon2 (préfixe absent).");
    }
    return decoded;
  } catch (err) {
    throw new Error(
      `AUTH_PASSWORD_HASH invalide : attendu base64 d'un hash argon2id. Utilise \`npm run hash-password\`. (${String(err)})`,
    );
  }
}

export async function verifyPassword(password: string): Promise<boolean> {
  return argon2.verify(decodedHash(), password);
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

/** Encode un hash PHC brut en base64 pour le mettre dans `.env`. */
export function encodeHashForEnv(phc: string): string {
  return Buffer.from(phc, "utf8").toString("base64");
}
