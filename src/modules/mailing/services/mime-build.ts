// Construction d'un message RFC 5322 en texte brut, pour APPEND IMAP (§7.1).
// On n'appelle pas nodemailer ici : la trame est simple (headers + body en
// texte brut, encodage utf-8), et un module de composition qui refléterait
// exactement ce qui est passé à SMTP serait dupliquer les règles nodemailer.
// Ce qu'on archive DOIT ressembler à ce qui est parti.

export interface BuildMimeInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId: string;
  bcc?: string | null;
  headers?: Record<string, string>; // In-Reply-To, References
  date?: Date;
}

const CRLF = "\r\n";

export function buildMime(input: BuildMimeInput): string {
  const lines: string[] = [];
  const push = (name: string, value: string): void => {
    lines.push(`${name}: ${foldHeader(value)}`);
  };

  push("From", input.from);
  push("To", input.to);
  if (input.bcc) push("Bcc", input.bcc);
  push("Subject", encodeSubject(input.subject));
  push("Date", (input.date ?? new Date()).toUTCString());
  push("Message-ID", ensureAngle(input.messageId));
  if (input.headers) {
    for (const [k, v] of Object.entries(input.headers)) {
      if (!v) continue;
      push(k, v);
    }
  }
  push("MIME-Version", "1.0");
  push("Content-Type", 'text/plain; charset="utf-8"');
  push("Content-Transfer-Encoding", "8bit");

  return lines.join(CRLF) + CRLF + CRLF + normalizeBody(input.text) + CRLF;
}

function ensureAngle(id: string): string {
  const t = id.trim();
  if (t.startsWith("<") && t.endsWith(">")) return t;
  return `<${t}>`;
}

function encodeSubject(s: string): string {
  // Si le sujet est pur ASCII imprimable, on le laisse. Sinon on encode en
  // MIME encoded-word Base64 UTF-8. Suffisant pour du prospection FR.
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const b64 = Buffer.from(s, "utf8").toString("base64");
  return `=?utf-8?B?${b64}?=`;
}

function foldHeader(value: string): string {
  // Fold sommaire à 78 caractères sur les espaces. Suffisant pour nos
  // usages (les valeurs > 78 sont rares : subject encodé, References longues).
  if (value.length <= 78) return value;
  const parts: string[] = [];
  let cur = "";
  for (const tok of value.split(" ")) {
    if (!cur) {
      cur = tok;
      continue;
    }
    if (cur.length + 1 + tok.length > 78) {
      parts.push(cur);
      cur = tok;
    } else {
      cur += " " + tok;
    }
  }
  if (cur) parts.push(cur);
  return parts.join(`${CRLF} `);
}

function normalizeBody(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n/g, CRLF);
}
