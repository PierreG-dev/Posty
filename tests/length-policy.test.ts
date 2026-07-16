import { describe, it, expect } from "vitest";
import { deriveTargetLength } from "@/modules/linkedin/domain/length-policy";
import type { Theme } from "@/modules/linkedin/domain/theme";

function themeFixture(overrides: {
  targetLength?: number | null;
  visualMode: "none" | "image" | "carousel";
}): Theme {
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
      targetLength: overrides.targetLength ?? null,
      hookPatterns: [],
      examples: [],
      forbiddenPhrases: [],
    },
    visual: { mode: overrides.visualMode, templateId: null, carouselSlides: 5 },
    defaultHashtags: [],
    active: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("deriveTargetLength", () => {
  it("mode none (texte seul) → 900-1500", () => {
    expect(deriveTargetLength(themeFixture({ visualMode: "none" }))).toEqual({
      min: 900,
      max: 1500,
    });
  });

  it("mode image → 600-1000", () => {
    expect(deriveTargetLength(themeFixture({ visualMode: "image" }))).toEqual({
      min: 600,
      max: 1000,
    });
  });

  it("mode carousel → 300-600", () => {
    expect(deriveTargetLength(themeFixture({ visualMode: "carousel" }))).toEqual({
      min: 300,
      max: 600,
    });
  });

  it("targetLength explicite écrase la dérivation (±20 %)", () => {
    const r = deriveTargetLength(themeFixture({ targetLength: 500, visualMode: "none" }));
    expect(r.min).toBe(400);
    expect(r.max).toBe(600);
  });
});
