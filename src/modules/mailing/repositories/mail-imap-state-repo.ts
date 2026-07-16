import { connectDb } from "@/modules/shared/db/mongoose";
import type { FolderState } from "@/modules/mailing/domain/mail-imap-state";
import { MailImapStateModel, type MailImapStateDoc } from "./mail-imap-state-model";

// §7-8 — watermark de scan IMAP. Un doc singleton, `folders[name]` = état.
// Si `uidValidity` change côté serveur (INBOX recréée), on reset `lastUid=0`
// et on rescanne : c'est plus sûr que d'ignorer.

async function loadDoc(): Promise<MailImapStateDoc> {
  await connectDb();
  const doc = await MailImapStateModel.findOneAndUpdate(
    { _id: "singleton" },
    { $setOnInsert: { folders: {} } },
    { new: true, upsert: true },
  ).lean<MailImapStateDoc>();
  if (!doc) throw new Error("mail_imap_state singleton introuvable après upsert");
  return doc;
}

export async function getFolderState(folder: string): Promise<FolderState | null> {
  const doc = await loadDoc();
  const folders = (doc.folders ?? {}) as Record<string, FolderState>;
  const raw = folders[folder];
  if (!raw) return null;
  return { uidValidity: Number(raw.uidValidity), lastUid: Number(raw.lastUid) };
}

/**
 * Réconcilie l'état avec `serverUidValidity`. Si celle-ci a changé, on
 * repart à zéro (le premier scan post-reset re-lit potentiellement toute
 * l'INBOX, c'est intentionnel — mieux vaut re-traiter que rater).
 */
export async function reconcileFolder(
  folder: string,
  serverUidValidity: number,
): Promise<FolderState> {
  await connectDb();
  const doc = await loadDoc();
  const folders = (doc.folders ?? {}) as Record<string, FolderState>;
  const cur = folders[folder];
  if (!cur || Number(cur.uidValidity) !== serverUidValidity) {
    const next: FolderState = { uidValidity: serverUidValidity, lastUid: 0 };
    await MailImapStateModel.updateOne(
      { _id: "singleton" },
      { $set: { [`folders.${folder}`]: next } },
    );
    return next;
  }
  return { uidValidity: Number(cur.uidValidity), lastUid: Number(cur.lastUid) };
}

export async function setFolderLastUid(folder: string, lastUid: number): Promise<void> {
  await connectDb();
  await MailImapStateModel.updateOne(
    { _id: "singleton" },
    { $set: { [`folders.${folder}.lastUid`]: lastUid } },
  );
}
