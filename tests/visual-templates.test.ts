import { describe, it, expect } from "vitest";
import { defaultRegistry, getTemplate } from "@/modules/linkedin/visuals/registry";
import { renderTemplateToPng, CANVAS_SIZE } from "@/modules/linkedin/visuals/render";

// PNG magic bytes : 89 50 4E 47 0D 0A 1A 0A
function isPng(buf: Buffer): boolean {
  if (buf.length < 24) return false;
  return (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

// Extrait width/height depuis les IHDR d'un PNG (offsets 16..23).
function pngDims(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Un cas de params par template : sert au smoke render ET à la vérif limites. */
const cases: Array<{ id: string; ok: unknown; tooLong: unknown }> = [
  {
    id: "code-card",
    ok: { title: "Refactor ce useEffect", language: "ts", code: "useEffect(() => {\n  fetch(url).then(setData);\n}, [url]);" },
    tooLong: { title: "x".repeat(200), language: "ts", code: "ok" },
  },
  {
    id: "before-after",
    ok: { title: "Sortir de la callback hell", before: "a(() => {\n  b(() => c())\n})", after: "await a();\nawait b();\nawait c();" },
    tooLong: { title: "ok", before: "x".repeat(50), after: "ok" },
  },
  {
    id: "tip-card",
    ok: { title: "3 pièges du hook useEffect", subtitle: "Retenus après 5 promos DWWM", bullets: ["Oublier le cleanup", "Deps mal listées", "Fetch sans AbortController"] },
    tooLong: { title: "ok", bullets: ["x".repeat(100), "ok", "ok"] },
  },
  {
    id: "checklist",
    ok: { title: "Avant de push", items: ["Tests verts", "Lint clean", "Diff relu"] },
    tooLong: { title: "ok", items: ["ok", "ok"] },
  },
  {
    id: "quote",
    ok: { text: "Le code qui compile n'est pas le code qui marche.", author: "moi, en formation" },
    tooLong: { text: "x".repeat(300), author: "moi" },
  },
  {
    id: "cover",
    ok: { title: "8 candidats sur 10 échouent ici", subtitle: "Retour d'expérience DWWM", badge: "carrousel" },
    tooLong: { title: "x".repeat(200) },
  },
  {
    id: "cta",
    ok: { headline: "Envie d'aller plus loin ?", action: "Réserve un créneau (lien en commentaire)", footer: "Pierre, formateur CDA/DWWM" },
    tooLong: { headline: "x".repeat(200), action: "ok" },
  },
];

describe("registry — templates enregistrés", () => {
  it("les 7 templates de prod sont enregistrés", () => {
    defaultRegistry(); // trigger side-effect
    for (const c of cases) {
      expect(getTemplate(c.id), `template manquant : ${c.id}`).toBeTruthy();
    }
  });

  it("listTemplates(image) exclut les slides pures (cover, cta)", () => {
    const list = defaultRegistry().listTemplates("image").map((t) => t.id);
    expect(list).not.toContain("cover");
    expect(list).not.toContain("cta");
    expect(list).toContain("code-card");
  });

  it("listTemplates(carousel) exclut les post-only et inclut cover/cta", () => {
    const list = defaultRegistry().listTemplates("carousel").map((t) => t.id);
    expect(list).toContain("cover");
    expect(list).toContain("cta");
    expect(list).toContain("tip-card"); // kind='both'
    expect(list).not.toContain("code-card"); // kind='post'
  });

  it("listTemplates(none) est vide", () => {
    expect(defaultRegistry().listTemplates("none")).toHaveLength(0);
  });
});

describe("templates — schema (rejet AVANT rendu)", () => {
  for (const c of cases) {
    it(`${c.id} : rejette un texte trop long`, () => {
      const tpl = getTemplate(c.id);
      expect(tpl).toBeTruthy();
      const res = tpl!.schema.safeParse(c.tooLong);
      expect(res.success).toBe(false);
    });
  }
});

describe("templates — rendu PNG 1200×1200", () => {
  for (const c of cases) {
    it(`${c.id} : rend un PNG valide aux bonnes dimensions`, async () => {
      const png = await renderTemplateToPng(c.id, c.ok);
      expect(isPng(png)).toBe(true);
      const dims = pngDims(png);
      expect(dims.width).toBe(CANVAS_SIZE);
      expect(dims.height).toBe(CANVAS_SIZE);
    }, 20_000);
  }

  it("texte trop long → throw AVANT d'atteindre Satori", async () => {
    await expect(
      renderTemplateToPng("code-card", { title: "x".repeat(200), code: "ok" }),
    ).rejects.toThrow(/Titre|55|invalides/i);
  });

  it("templateId inconnu → throw explicite", async () => {
    await expect(renderTemplateToPng("does-not-exist", {})).rejects.toThrow(/inconnu/i);
  });
});
