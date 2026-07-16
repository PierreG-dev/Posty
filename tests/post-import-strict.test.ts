import { describe, it, expect } from "vitest";
import { parseJsonImport } from "@/modules/linkedin/services/post-import";
import type { Theme } from "@/modules/linkedin/domain/theme";

const t: Theme = {
  _id: "t1",
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
    forbiddenPhrases: ["voici 5 astuces"],
  },
  visual: { mode: "none", templateId: null, carouselSlides: 5 },
  defaultHashtags: [],
  active: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const OK = "Hook court.\n" + "corps ".repeat(150) + "fin"; // ~950 chars, mode none

describe("parseJsonImport — sans thème", () => {
  it("rétrocompatible : accepte un item sans validation stricte", () => {
    const raw = JSON.stringify({ content: "juste 20 caractères ok" });
    const r = parseJsonImport(raw);
    expect(r.errors).toEqual([]);
    expect(r.drafts).toHaveLength(1);
  });
});

describe("parseJsonImport — avec thème (validateur strict §8.8)", () => {
  it("accepte un item conforme aux règles du thème", () => {
    const raw = JSON.stringify({
      content: OK,
      hashtags: ["#dev", "#formation", "#dwwm"],
    });
    const r = parseJsonImport(raw, { theme: t });
    expect(r.errors).toEqual([]);
    expect(r.drafts).toHaveLength(1);
  });

  it("rejette un item avec une URL dans le corps", () => {
    const raw = JSON.stringify({
      content: "Hook.\n" + "voir https://x.com pour plus\n" + "corps ".repeat(150),
      hashtags: ["#dev", "#formation", "#dwwm"],
    });
    const r = parseJsonImport(raw, { theme: t });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.drafts).toHaveLength(0);
  });

  it("rejette une formulation interdite du thème", () => {
    const raw = JSON.stringify({
      content: "Hook.\n" + "voici 5 astuces\n" + "corps ".repeat(150),
      hashtags: ["#dev", "#formation", "#dwwm"],
    });
    const r = parseJsonImport(raw, { theme: t });
    expect(r.errors.some((e) => /interdite/i.test(e.message))).toBe(true);
  });

  it("dans un tableau, erreur sur un item seulement → autres items OK", () => {
    const raw = JSON.stringify([
      { content: OK, hashtags: ["#dev", "#formation", "#dwwm"] },
      { content: "Hook.\nhttps://bad.com\n" + "corps ".repeat(150), hashtags: ["#dev", "#formation", "#dwwm"] },
      { content: OK, hashtags: ["#dev", "#formation", "#dwwm"] },
    ]);
    const r = parseJsonImport(raw, { theme: t });
    expect(r.drafts).toHaveLength(2);
    // L'erreur porte l'index 1 (le mauvais).
    expect(r.errors.some((e) => e.index === 1)).toBe(true);
    expect(r.errors.every((e) => e.index !== 0 && e.index !== 2)).toBe(true);
  });
});
