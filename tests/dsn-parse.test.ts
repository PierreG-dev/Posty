import { describe, it, expect } from "vitest";
import { parseDsn, isDsnMessage } from "@/modules/mailing/services/dsn-parse";
import type { ImapMessage } from "@/modules/mailing/services/imap";

function msg(partial: Partial<ImapMessage> = {}): ImapMessage {
  return {
    uid: partial.uid ?? 1,
    headers: partial.headers ?? {},
    from: partial.from ?? "mailer-daemon@example.com",
    to: partial.to ?? ["me@pierre-godino.com"],
    subject: partial.subject ?? "Undelivered Mail Returned to Sender",
    messageId: partial.messageId ?? "bounce@example.com",
    inReplyTo: partial.inReplyTo ?? null,
    references: partial.references ?? [],
    contentType: partial.contentType ?? "multipart/report; report-type=delivery-status",
    body: partial.body ?? "",
    date: partial.date ?? null,
  };
}

const DSN_HARD = `
Content-Type: message/delivery-status

Reporting-MTA: dns; mx.example.com

Final-Recipient: rfc822; nobody@ghost.tld
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 <nobody@ghost.tld>: Recipient address rejected: User unknown in virtual mailbox table
`;

const DSN_SOFT = `
Content-Type: message/delivery-status

Reporting-MTA: dns; mx.example.com

Final-Recipient: rfc822; slow@overloaded.tld
Action: delayed
Status: 4.2.0
Diagnostic-Code: smtp; 452 4.2.0 Temporary greylisting
`;

describe("dsn-parse", () => {
  it("détecte un message DSN via Content-Type", () => {
    expect(isDsnMessage(msg({}))).toBe(true);
    expect(isDsnMessage(msg({ contentType: "text/plain" }))).toBe(false);
  });

  it("parse un hard bounce 5.1.1", () => {
    const p = parseDsn(msg({ body: DSN_HARD }));
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("hard");
    expect(p!.status).toBe("5.1.1");
    expect(p!.email).toBe("nobody@ghost.tld");
    expect(p!.diagnostic).toContain("550");
  });

  it("parse un soft bounce 4.2.0", () => {
    const p = parseDsn(msg({ body: DSN_SOFT }));
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("soft");
    expect(p!.status).toBe("4.2.0");
    expect(p!.email).toBe("slow@overloaded.tld");
  });

  it("retourne null si Status manquant", () => {
    expect(parseDsn(msg({ body: "Final-Recipient: rfc822; x@y.tld\n" }))).toBeNull();
  });

  it("retourne null si Final-Recipient manquant", () => {
    expect(parseDsn(msg({ body: "Status: 5.1.1\n" }))).toBeNull();
  });
});
