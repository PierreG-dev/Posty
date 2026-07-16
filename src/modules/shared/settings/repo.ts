import { connectDb } from "@/modules/shared/db/mongoose";
import { decrypt, encrypt } from "@/modules/shared/crypto/aes";
import { SettingsModel, SETTINGS_ID, type SettingsDoc } from "./model";

export async function getSettings(): Promise<SettingsDoc> {
  await connectDb();
  const existing = await SettingsModel.findById(SETTINGS_ID).lean<SettingsDoc>();
  if (existing) return existing;
  const created = await SettingsModel.create({ _id: SETTINGS_ID });
  return created.toObject() as SettingsDoc;
}

export interface LinkedInCredentials {
  authorUrn: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  refreshExpiresAt: Date;
}

/** Renvoie les tokens LinkedIn en clair, ou null si non connecté. */
export async function getLinkedInCredentials(): Promise<LinkedInCredentials | null> {
  const s = await getSettings();
  const l = s.linkedin;
  if (!l?.authorUrn || !l.accessToken || !l.refreshToken || !l.expiresAt || !l.refreshExpiresAt) {
    return null;
  }
  return {
    authorUrn: l.authorUrn,
    accessToken: decrypt(l.accessToken),
    refreshToken: decrypt(l.refreshToken),
    expiresAt: l.expiresAt,
    refreshExpiresAt: l.refreshExpiresAt,
  };
}

/** Écrit les tokens LinkedIn en base, chiffrés (AES-256-GCM). */
export async function saveLinkedInCredentials(creds: LinkedInCredentials): Promise<void> {
  await connectDb();
  await SettingsModel.updateOne(
    { _id: SETTINGS_ID },
    {
      $set: {
        "linkedin.authorUrn": creds.authorUrn,
        "linkedin.accessToken": encrypt(creds.accessToken),
        "linkedin.refreshToken": encrypt(creds.refreshToken),
        "linkedin.expiresAt": creds.expiresAt,
        "linkedin.refreshExpiresAt": creds.refreshExpiresAt,
      },
    },
    { upsert: true },
  );
}

/** Statut LinkedIn public (sans tokens, safe pour l'UI). */
export interface LinkedInStatus {
  connected: boolean;
  authorUrn: string | null;
  expiresAt: Date | null;
  refreshExpiresAt: Date | null;
  dryRun: boolean;
}

export async function getLinkedInStatus(): Promise<LinkedInStatus> {
  const s = await getSettings();
  const l = s.linkedin;
  return {
    connected: Boolean(l?.authorUrn && l.accessToken && l.refreshToken),
    authorUrn: l?.authorUrn ?? null,
    expiresAt: l?.expiresAt ?? null,
    refreshExpiresAt: l?.refreshExpiresAt ?? null,
    dryRun: s.dryRun,
  };
}
