import { describe, it, expect } from "vitest";
import { buildMime } from "@/modules/mailing/services/mime-build";
import { parseRawMime } from "@/modules/mailing/services/imap";

// La trame MIME construite pour l'archivage IMAP DOIT être lisible par notre
// propre parseur (celui utilisé pour le scan) : c'est le contrat minimum, et
// le smoke-test qui garantit qu'un mail archivé sera aussi ré-inspectable.

describe("mime-build", () => {
  it("produit un message parsable, headers ronds-de-jambe corrects", () => {
    const mime = buildMime({
      from: "me@pierre-godino.com",
      to: "prospect@acme.io",
      subject: "Formateur dev web disponible",
      text: "Bonjour l'équipe d'Acme,\n\nCorps du mail.\n\nCordialement.",
      messageId: "abc123@posty.local",
      headers: { "In-Reply-To": "<prev@x.com>", References: "<prev@x.com>" },
      date: new Date("2026-07-16T10:00:00Z"),
    });
    expect(mime).toContain("From: me@pierre-godino.com");
    expect(mime).toContain("Subject: Formateur dev web disponible");
    expect(mime).toContain("Message-ID: <abc123@posty.local>");
    expect(mime).toContain("In-Reply-To: <prev@x.com>");
    expect(mime).toContain("MIME-Version: 1.0");
    expect(mime).toMatch(/Content-Type: text\/plain; charset=/);

    const parsed = parseRawMime(mime, 1);
    expect(parsed.from).toBe("me@pierre-godino.com");
    expect(parsed.to).toContain("prospect@acme.io");
    expect(parsed.messageId).toBe("abc123@posty.local");
    expect(parsed.inReplyTo).toBe("prev@x.com");
    expect(parsed.references).toEqual(["prev@x.com"]);
    // Le corps normalisé contient le début du texte.
    expect(parsed.body).toContain("Bonjour");
  });

  it("encode un sujet non-ASCII en encoded-word Base64", () => {
    const mime = buildMime({
      from: "me@x",
      to: "you@x",
      subject: "Re: proposition — été 2026",
      text: "corps",
      messageId: "m@x",
    });
    expect(mime).toMatch(/Subject: =\?utf-8\?B\?/);
  });

  it("ajoute un Bcc si fourni", () => {
    const mime = buildMime({
      from: "a@b", to: "c@d", subject: "s", text: "t", messageId: "m@x",
      bcc: "logs@pierre-godino.com",
    });
    expect(mime).toContain("Bcc: logs@pierre-godino.com");
  });
});
