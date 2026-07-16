import { z } from "zod";

// §7-8 CDC-02 — watermark UID par dossier IMAP scanné (INBOX + Spam). On
// stocke `uidValidity` pour détecter une INBOX recréée (reset auto), et
// `lastUid` pour ne pas re-traiter un message déjà scanné. Aucune modif de
// la boîte n'est faite — pas de \Seen, pas de move (réponse utilisateur au
// plan §9). Un singleton par dossier logique.

export const folderStateSchema = z.object({
  uidValidity: z.number().int().nonnegative(),
  lastUid: z.number().int().nonnegative(),
});
export type FolderState = z.infer<typeof folderStateSchema>;

export const mailImapStateSchema = z.object({
  _id: z.literal("singleton"),
  folders: z.record(z.string(), folderStateSchema).default({}),
  updatedAt: z.date().optional(),
});
export type MailImapState = z.infer<typeof mailImapStateSchema>;
