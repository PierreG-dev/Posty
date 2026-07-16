import { describe, it, expect } from "vitest";
import {
  escapeCommentary,
  RESERVED_COMMENTARY_CHARS,
} from "@/modules/linkedin/linkedin-api/escape-commentary";

// Un test par caractère, comme demandé (spike + prompt lot 3).
describe("escapeCommentary — un caractère réservé à la fois", () => {
  for (const ch of RESERVED_COMMENTARY_CHARS) {
    it(`préfixe ${JSON.stringify(ch)} d'un backslash`, () => {
      expect(escapeCommentary(`abc${ch}def`)).toBe(`abc\\${ch}def`);
    });
  }
});

describe("escapeCommentary — propriétés transverses", () => {
  it("est idempotent : escape(escape(x)) === escape(x)", () => {
    const samples = [
      "hello (world) [foo]",
      "code: {a}|b~c_d*e @you",
      "no special char here",
      "mix < > and @",
    ];
    for (const s of samples) {
      const once = escapeCommentary(s);
      const twice = escapeCommentary(once);
      expect(twice).toBe(once);
    }
  });

  it("préserve tous les caractères non listés", () => {
    const input = "Hello, World! 123 àéîôü — 🚀 \"quotes\" 'apos' /slash\\";
    expect(escapeCommentary(input)).toBe(input);
  });

  it("échappe tous les 13 caractères dans une chaîne mixte", () => {
    const raw = RESERVED_COMMENTARY_CHARS.join("");
    const out = escapeCommentary(raw);
    // Chaque caractère doit être précédé d'un backslash.
    for (const ch of RESERVED_COMMENTARY_CHARS) {
      expect(out).toContain(`\\${ch}`);
    }
    // La sortie fait exactement 2x la longueur d'entrée (1 backslash par caractère).
    expect(out.length).toBe(raw.length * 2);
  });

  it("n'échappe pas les caractères déjà précédés d'un backslash", () => {
    const input = "\\(déjà)";  // seul le `)` doit être échappé
    expect(escapeCommentary(input)).toBe("\\(déjà\\)");
  });
});
