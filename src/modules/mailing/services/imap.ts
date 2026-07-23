import { logger } from "@/modules/shared/logger";
import type { MailSettings } from "@/modules/mailing/domain/mail-settings";

// CDC-02 §7-8 — client IMAP isolé et mockable. Le reste du module (archivage
// dans send-tick, inspection bounces/réponses) ne connaît que l'interface.
// imapflow est chargé dynamiquement pour que le module reste importable en
// test unitaire sans ouvrir de socket.

export interface ImapAppendInput {
  folder: string;
  raw: string | Buffer; // MIME RFC 5322 complet
  flags?: readonly string[];
}

export interface ImapMessage {
  uid: number;
  headers: Record<string, string>; // clés en lowercase
  from: string | null;
  to: string[];
  subject: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[]; // parsées depuis References
  contentType: string;
  body: string; // corps brut (headers + parts, texte)
  date: Date | null;
}

export interface ImapFetchOpts {
  folder: string;
  sinceUid: number; // 0 = tout
}

export interface ImapFetchResult {
  uidValidity: number;
  messages: ImapMessage[]; // triés par UID croissant
}

export interface ImapClient {
  ensureFolder(name: string): Promise<void>;
  append(input: ImapAppendInput): Promise<void>;
  fetchNewMessages(opts: ImapFetchOpts): Promise<ImapFetchResult>;
  close(): Promise<void>;
}

// ─── Implémentation imapflow (dynamique) ────────────────────────────────────

export async function createImapflowClient(settings: MailSettings): Promise<ImapClient> {
  if (!settings.imap.host) throw new Error("IMAP host non configuré");
  // Import dynamique — imapflow ne doit pas être tiré côté vitest / build web.
  const mod = (await import("imapflow")) as unknown as {
    ImapFlow: new (opts: unknown) => ImapFlowInstance;
  };
  const client: ImapFlowInstance = new mod.ImapFlow({
    host: settings.imap.host,
    port: settings.imap.port,
    secure: settings.imap.port === 993,
    auth: { user: settings.imap.user, pass: settings.imap.pass },
    logger: false,
  });
  await client.connect();

  return {
    async ensureFolder(name: string): Promise<void> {
      // imapflow n'a pas de mailboxExists() — on liste et on cherche le path.
      const mailboxes = await client.list();
      const exists = mailboxes.some((m) => m.path === name);
      if (!exists) {
        await client.mailboxCreate(name);
        logger.info("mailing.imap.folder_created", { folder: name });
      }
    },
    async append({ folder, raw, flags }: ImapAppendInput): Promise<void> {
      await client.append(folder, raw, flags ? [...flags] : undefined);
    },
    async fetchNewMessages({ folder, sinceUid }: ImapFetchOpts): Promise<ImapFetchResult> {
      const lock = await client.getMailboxLock(folder);
      try {
        const mbox = client.mailbox;
        const uidValidity = Number(mbox?.uidValidity ?? 0);
        const range = sinceUid > 0 ? `${sinceUid + 1}:*` : "1:*";
        const out: ImapMessage[] = [];
        const it = client.fetch(
          range,
          { uid: true, source: true, envelope: true, bodyStructure: false },
          { uid: true },
        );
        for await (const msg of it) {
          const raw = String(msg.source ?? "");
          out.push(parseRawMime(raw, Number(msg.uid)));
        }
        out.sort((a, b) => a.uid - b.uid);
        return { uidValidity, messages: out };
      } finally {
        lock.release();
      }
    },
    async close(): Promise<void> {
      try {
        await client.logout();
      } catch {
        // ignore
      }
    },
  };
}

// Sous-typage minimal d'imapflow — on n'importe pas ses types (dep dynamique).
interface ImapFlowInstance {
  connect(): Promise<void>;
  logout(): Promise<void>;
  list(): Promise<Array<{ path: string }>>;
  mailboxCreate(name: string): Promise<void>;
  mailbox: { uidValidity?: number | bigint } | undefined;
  getMailboxLock(name: string): Promise<{ release(): void }>;
  append(folder: string, raw: string | Buffer, flags?: string[]): Promise<void>;
  fetch(
    range: string,
    opts: { uid: boolean; source: boolean; envelope?: boolean; bodyStructure?: boolean },
    query: { uid: boolean },
  ): AsyncIterable<{ uid: number | bigint; source: Buffer | string }>;
}

// ─── Parseur MIME minimal ──────────────────────────────────────────────────
// On ne fait pas de décodage complet (quoted-printable, base64) sur le body :
// pour nos deux usages (détection DSN via Content-Type + Status, détection
// réponse via headers), les headers suffisent. Le corps est renvoyé brut.

export function parseRawMime(raw: string, uid: number): ImapMessage {
  const norm = raw.replace(/\r\n/g, "\n");
  const sep = norm.indexOf("\n\n");
  const headerBlob = sep >= 0 ? norm.slice(0, sep) : norm;
  const body = sep >= 0 ? norm.slice(sep + 2) : "";

  const headers = parseHeaders(headerBlob);

  const messageId = headers["message-id"] ? extractAngle(headers["message-id"]) : null;
  const inReplyTo = headers["in-reply-to"] ? extractAngle(headers["in-reply-to"]) : null;
  const references = headers["references"]
    ? extractAllAngles(headers["references"])
    : [];

  const from = headers["from"] ? extractEmail(headers["from"]) : null;
  const to = headers["to"] ? headers["to"].split(",").map(extractEmail).filter((v): v is string => !!v) : [];
  const subject = headers["subject"] ?? "";
  const contentType = headers["content-type"] ?? "";
  const dateStr = headers["date"];
  const date = dateStr ? safeDate(dateStr) : null;

  return { uid, headers, from, to, subject, messageId, inReplyTo, references, contentType, body, date };
}

function parseHeaders(blob: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines: string[] = [];
  // Unfolding : les lignes qui commencent par un espace/tab prolongent la précédente.
  for (const line of blob.split("\n")) {
    if (/^[ \t]/.test(line) && lines.length > 0) {
      lines[lines.length - 1] += " " + line.trim();
    } else {
      lines.push(line);
    }
  }
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    // Si un header apparaît plusieurs fois, on concatène (rare, safe).
    out[key] = out[key] ? `${out[key]} ${val}` : val;
  }
  return out;
}

function extractAngle(s: string): string | null {
  const m = s.match(/<([^>]+)>/);
  if (m && m[1]) return m[1].trim();
  return s.trim() || null;
}

function extractAllAngles(s: string): string[] {
  const out: string[] = [];
  const re = /<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[1]) out.push(m[1].trim());
  }
  return out;
}

function extractEmail(s: string): string | null {
  const angle = s.match(/<([^>]+)>/);
  if (angle && angle[1]) return angle[1].trim().toLowerCase();
  const raw = s.trim().toLowerCase();
  // Fallback : chaîne contenant @
  if (raw.includes("@")) return raw.split(/\s+/).find((t) => t.includes("@")) ?? raw;
  return null;
}

function safeDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
