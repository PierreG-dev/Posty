import { describe, it, expect } from "vitest";
import { defaultRegistry } from "@/modules/linkedin/visuals/registry";
import { buildContractFragment } from "@/modules/linkedin/services/prompt-builder";
import { validateGeneratedPost } from "@/modules/linkedin/domain/validate-generated-post";
import type { Theme } from "@/modules/linkedin/domain/theme";

function theme(overrides: Partial<Theme> = {}): Theme {
  const now = new Date();
  return {
    _id: "t1",
    name: "Thème test",
    slug: "test",
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
    },
    visual: { mode: "image", templateId: null, carouselSlides: 5 },
    defaultHashtags: ["#a", "#b", "#c"],
    active: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Theme;
}

describe("contrat JSON dérivé du registry (§8.7 / §9)", () => {
  it("mode=image : le fragment contient les ids des templates image", () => {
    const t = theme({ visual: { mode: "image", templateId: null, carouselSlides: 5 } });
    const frag = buildContractFragment(t, defaultRegistry());
    // Doit citer plusieurs templates possibles pour visual.
    expect(frag).toMatch(/"code-card"/);
    expect(frag).toMatch(/"tip-card"/);
    // Cover/CTA sont slide-only : ne doivent PAS apparaître pour visual.
    expect(frag).not.toMatch(/"cover"/);
    expect(frag).not.toMatch(/"cta"/);
    expect(frag).toMatch(/"carousel": null/);
  });

  it("mode=carousel : le fragment cite cover/cta et 3-10 slides", () => {
    const t = theme({ visual: { mode: "carousel", templateId: null, carouselSlides: 5 } });
    const frag = buildContractFragment(t, defaultRegistry());
    expect(frag).toMatch(/"cover"/);
    expect(frag).toMatch(/"cta"/);
    expect(frag).toMatch(/3 à 10 slides/);
    expect(frag).toMatch(/"visual": null/);
  });

  it("mode=none : contrat impose visual:null ET carousel:null", () => {
    const t = theme({ visual: { mode: "none", templateId: null, carouselSlides: 5 } });
    const frag = buildContractFragment(t, defaultRegistry());
    expect(frag).toMatch(/"visual": null/);
    expect(frag).toMatch(/"carousel": null/);
  });
});

describe("validateur (§8.8) branché sur le vrai registry", () => {
  const validVisual = { templateId: "code-card", params: { title: "OK", language: "ts", code: "const x=1;" } };
  const baseJson = {
    content: "Une ligne accroche courte.\n\nDu contenu suffisamment long pour éviter le warning de longueur. ".repeat(20),
    hashtags: ["#a", "#b", "#c"],
    firstComment: null,
    altText: "alt",
  };

  it("mode=image + visual valide → OK", () => {
    const t = theme();
    const res = validateGeneratedPost({ ...baseJson, visual: validVisual, carousel: null }, t);
    expect(res.ok).toBe(true);
  });

  it("mode=image + params qui dépassent la limite → rejet AVANT rendu", () => {
    const t = theme();
    const res = validateGeneratedPost(
      {
        ...baseJson,
        visual: { templateId: "code-card", params: { title: "x".repeat(200), code: "ok" } },
        carousel: null,
      },
      t,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => /55|Titre/i.test(e.message))).toBe(true);
    }
  });

  it("mode=carousel avec 2 slides → rejet (min 3)", () => {
    const t = theme({ visual: { mode: "carousel", templateId: null, carouselSlides: 5 } });
    const res = validateGeneratedPost(
      {
        ...baseJson,
        visual: null,
        carousel: {
          slides: [
            { templateId: "cover", params: { title: "T", subtitle: "s" } },
            { templateId: "cta", params: { headline: "H", action: "Go" } },
          ],
        },
      },
      t,
    );
    expect(res.ok).toBe(false);
  });

  it("mode=carousel avec 3 slides valides → OK", () => {
    const t = theme({ visual: { mode: "carousel", templateId: null, carouselSlides: 5 } });
    const res = validateGeneratedPost(
      {
        ...baseJson,
        visual: null,
        carousel: {
          slides: [
            { templateId: "cover", params: { title: "T", subtitle: "s" } },
            { templateId: "tip-card", params: { title: "Mid", bullets: ["a", "b", "c"] } },
            { templateId: "cta", params: { headline: "H", action: "Go" } },
          ],
        },
      },
      t,
    );
    expect(res.ok).toBe(true);
  });

  it("mode=image + visual=null → OK (visuel optionnel)", () => {
    const t = theme();
    const res = validateGeneratedPost({ ...baseJson, visual: null, carousel: null }, t);
    expect(res.ok).toBe(true);
  });
});
