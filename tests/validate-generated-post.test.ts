import { describe, it, expect } from "vitest";
import { validateGeneratedPost } from "@/modules/linkedin/domain/validate-generated-post";
import type { Theme } from "@/modules/linkedin/domain/theme";

function theme(overrides: Partial<Theme["ai"]> = {}, visualMode: "none" | "image" | "carousel" = "none"): Theme {
  return {
    _id: "t",
    name: "t",
    slug: "t",
    color: "#FFB020",
    emoji: "",
    description: "",
    ai: {
      enabled: true,
      systemPrompt: "",
      structure: "",
      targetLength: null,
      hookPatterns: [],
      examples: [],
      forbiddenPhrases: [],
      ...overrides,
    },
    visual: { mode: visualMode, templateId: null, carouselSlides: 5 },
    defaultHashtags: [],
    active: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

// Content par défaut : 950 caractères (dans la fourchette 900-1500 du mode none),
// première ligne courte, pas de markdown, pas d'URL.
const HOOK = "J'ai mis trois ans à comprendre que le débogueur est le meilleur professeur.\n";
const BODY = "corps ".repeat(150) + "fin"; // ~875 chars
const OK_CONTENT = HOOK + BODY; // ~950 chars

function payload(overrides: Record<string, unknown> = {}) {
  return {
    content: OK_CONTENT,
    hashtags: ["#dev", "#formation", "#dwwm"],
    firstComment: null,
    visual: null,
    carousel: null,
    altText: "",
    ...overrides,
  };
}

describe("validateGeneratedPost — règles §8.8", () => {
  it("accepte un post conforme", () => {
    const r = validateGeneratedPost(payload(), theme());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it("rejette content > 3000 caractères (limite dure LinkedIn)", () => {
    const r = validateGeneratedPost(payload({ content: "x".repeat(3001) }), theme());
    expect(r.ok).toBe(false);
  });

  it("rejette une première ligne > 100 caractères", () => {
    const longHook = "x".repeat(101) + "\nsuite";
    const r = validateGeneratedPost(payload({ content: longHook + "\n" + BODY }), theme());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /Première ligne/i.test(e.message))).toBe(true);
  });

  it("rejette le markdown **gras**", () => {
    const withMd = HOOK + "voici du **gras** " + BODY;
    const r = validateGeneratedPost(payload({ content: withMd }), theme());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /Markdown/i.test(e.message))).toBe(true);
  });

  it("rejette le markdown # titre en début de ligne", () => {
    const withMd = HOOK + "# Titre\n" + BODY;
    const r = validateGeneratedPost(payload({ content: withMd }), theme());
    expect(r.ok).toBe(false);
  });

  it("rejette le markdown - puce en début de ligne", () => {
    const withMd = HOOK + "- puce\n" + BODY;
    const r = validateGeneratedPost(payload({ content: withMd }), theme());
    expect(r.ok).toBe(false);
  });

  it("rejette une URL http:// dans le corps", () => {
    const withUrl = HOOK + "voir http://example.com\n" + BODY;
    const r = validateGeneratedPost(payload({ content: withUrl }), theme());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /firstComment/i.test(e.message))).toBe(true);
  });

  it("rejette une URL https:// dans le corps", () => {
    const withUrl = HOOK + "https://exemple.com\n" + BODY;
    const r = validateGeneratedPost(payload({ content: withUrl }), theme());
    expect(r.ok).toBe(false);
  });

  it("rejette moins de 3 hashtags", () => {
    const r = validateGeneratedPost(payload({ hashtags: ["#dev", "#formation"] }), theme());
    expect(r.ok).toBe(false);
  });

  it("rejette plus de 5 hashtags", () => {
    const r = validateGeneratedPost(
      payload({ hashtags: ["#a", "#b", "#c", "#d", "#e", "#f"] }),
      theme(),
    );
    expect(r.ok).toBe(false);
  });

  it("rejette un hashtag mal formé", () => {
    const r = validateGeneratedPost(payload({ hashtags: ["#dev", "sansdiese", "#form"] }), theme());
    expect(r.ok).toBe(false);
  });

  it("rejette la présence d'une formulation interdite du thème", () => {
    const t = theme({ forbiddenPhrases: ["voici 5 astuces"] });
    const withBanned = HOOK + "aujourd'hui, VOICI 5 ASTUCES pour toi\n" + BODY;
    const r = validateGeneratedPost(payload({ content: withBanned }), t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /interdite/i.test(e.message))).toBe(true);
  });

  it("longueur hors fourchette dérivée → warning non bloquant", () => {
    const short = HOOK + "trop court"; // ~85 chars, mode none → range 900-1500
    const r = validateGeneratedPost(payload({ content: short }), theme());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => /fourchette/i.test(w.message))).toBe(true);
  });

  it("rejette un visual/carousel non-null (registry stub impose null)", () => {
    const r = validateGeneratedPost(payload({ visual: { foo: "bar" } }), theme(undefined, "image"));
    expect(r.ok).toBe(false);
  });
});
