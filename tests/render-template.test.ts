import { describe, it, expect } from "vitest";
import { renderTemplate, renderSubject, TemplateRenderError } from "@/modules/mailing/domain/render-template";
import type { MailBlock } from "@/modules/mailing/domain/mail-blocks";

function makeBlock(name: string, content: string): MailBlock {
  return {
    _id: name,
    name,
    kind: "custom",
    content,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("renderTemplate", () => {
  it("substitue {{GREETING}}", () => {
    const out = renderTemplate("{{GREETING}}\n\nCorps.", { greeting: "Bonjour l'équipe d'X," }, []);
    expect(out).toBe("Bonjour l'équipe d'X,\n\nCorps.");
  });

  it("substitue {{BLOCK:signature}} par le contenu du bloc", () => {
    const sig = makeBlock("signature", "-- Pierre\nDev");
    const out = renderTemplate("Fin.\n\n{{BLOCK:signature}}", { greeting: "" }, [sig]);
    expect(out).toBe("Fin.\n\n-- Pierre\nDev");
  });

  it("tolère les espaces autour du token", () => {
    const sig = makeBlock("signature", "SIG");
    const out = renderTemplate("A {{  GREETING  }} B {{ BLOCK:signature }}", { greeting: "hey," }, [sig]);
    expect(out).toBe("A hey, B SIG");
  });

  it("lève sur bloc introuvable — mieux que d'envoyer {{BLOCK:...}} brut", () => {
    expect(() => renderTemplate("{{BLOCK:absent}}", { greeting: "" }, [])).toThrow(TemplateRenderError);
  });

  it("lève sur variable inconnue", () => {
    expect(() => renderTemplate("{{UNKNOWN}}", { greeting: "" }, [])).toThrow(TemplateRenderError);
  });

  it("renderSubject rejette {{BLOCK:...}}", () => {
    expect(() => renderSubject("Sujet {{BLOCK:x}}", { greeting: "" })).toThrow(TemplateRenderError);
  });

  it("renderSubject substitue {{GREETING}}", () => {
    expect(renderSubject("Bonjour {{GREETING}}", { greeting: "monde," })).toBe("Bonjour monde,");
  });
});
