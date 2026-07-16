import type { ImapMessage } from "./imap";

// CDC-02 §8.1 — parseur DSN (Delivery Status Notification, RFC 3464). On
// détecte le type via Content-Type: multipart/report; report-type=delivery-status
// puis on extrait `Status:` et `Final-Recipient:` du sous-part.
// - 5.x.x → hard bounce
// - 4.x.x → soft bounce (3 consécutifs → escalade en hard, géré côté service)

export interface DsnParsed {
  email: string; // lowercase
  status: string; // ex "5.1.1"
  kind: "hard" | "soft";
  diagnostic: string | null;
}

export function isDsnMessage(msg: ImapMessage): boolean {
  const ct = msg.contentType.toLowerCase();
  return ct.includes("multipart/report") && ct.includes("delivery-status");
}

/**
 * Extrait la première (ou seule) entrée DSN du corps du message. Retourne
 * null si non parsable — dans ce cas le message est ignoré et on log.
 */
export function parseDsn(msg: ImapMessage): DsnParsed | null {
  // Le body est brut (headers + parts, sans décodage). On cherche la
  // sous-part `message/delivery-status` par sa présence textuelle. C'est
  // volontairement tolérant : les serveurs mail sont hétérogènes.
  const norm = msg.body.replace(/\r\n/g, "\n");

  // Récupère Final-Recipient et Status. Un DSN peut contenir plusieurs
  // "Final-Recipient" (un par destinataire). On prend le premier bloc dont
  // on trouve un Status associé.
  const statusMatch = norm.match(/^Status:\s*([245]\.\d+\.\d+)/im);
  if (!statusMatch || !statusMatch[1]) return null;
  const status = statusMatch[1];

  const recipMatch = norm.match(/^Final-Recipient:\s*(?:rfc822;)?\s*([^\r\n]+)/im);
  const emailRaw = recipMatch && recipMatch[1] ? recipMatch[1].trim() : null;
  const email = emailRaw ? extractAddr(emailRaw) : null;
  if (!email) return null;

  const diagMatch = norm.match(/^Diagnostic-Code:\s*([^\r\n]+(?:\n\s+[^\r\n]+)*)/im);
  const diagnostic = diagMatch && diagMatch[1] ? diagMatch[1].trim().replace(/\s+/g, " ") : null;

  const kind = status.startsWith("5") ? "hard" : "soft";
  return { email: email.toLowerCase(), status, kind, diagnostic };
}

function extractAddr(raw: string): string | null {
  const angle = raw.match(/<([^>]+)>/);
  if (angle && angle[1]) return angle[1].trim();
  const bare = raw.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  return bare ? bare[0] : null;
}
