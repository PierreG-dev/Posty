import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildStandalonePrompt,
  buildContractFragment,
  LOCALIZATION_RULE,
} from "@/modules/linkedin/services/prompt-builder";
import { defaultRegistry } from "@/modules/linkedin/visuals/registry";
import type { Theme } from "@/modules/linkedin/domain/theme";
import type { Post } from "@/modules/linkedin/domain/post";

function theme(overrides: Partial<Theme["ai"]> = {}): Theme {
  return {
    _id: "t1",
    name: "Pédagogie DWWM",
    slug: "pedagogie",
    color: "#FFB020",
    emoji: "📚",
    description: "",
    ai: {
      enabled: true,
      systemPrompt: "Angle : retours de terrain.",
      structure: "Hook / contexte / 3 points / CTA",
      targetLength: null,
      hookPatterns: ["aveu", "chiffre"],
      examples: ["Exemple 1 — un post modèle."],
      forbiddenPhrases: ["voici 5 astuces"],
      ...overrides,
    },
    visual: { mode: "none", templateId: null, carouselSlides: 5 },
    defaultHashtags: ["#dev"],
    active: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function post(content: string, index = 0): Post {
  return {
    _id: "p" + index,
    content,
    hashtags: [],
    themeId: "t1",
    status: "published",
    source: "manual",
    media: { kind: "none", assetId: null, altText: "", title: "" },
    firstComment: { text: null, status: "none" },
    queuePosition: 0,
    scheduledAt: null,
    publishedAt: new Date(),
    linkedin: { urn: null, url: null },
    attempts: 0,
    lastError: null,
    aiMeta: null,
    sourceExternalId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("buildSystemPrompt", () => {
  it("contient la règle dure « aucune localisation » MOT POUR MOT (§8.5)", () => {
    const sys = buildSystemPrompt(theme(), defaultRegistry());
    expect(sys).toContain(LOCALIZATION_RULE);
    // Vérification supplémentaire des marqueurs clefs qui doivent y figurer.
    expect(sys).toMatch(/localisation géographique/);
    expect(sys).toMatch(/voyage ou d'expatriation/);
    expect(sys).toMatch(/Aucun marqueur temporel local/);
  });

  it("injecte les hookPatterns du thème", () => {
    const sys = buildSystemPrompt(theme({ hookPatterns: ["aveu", "chiffre"] }), defaultRegistry());
    expect(sys).toMatch(/aveu/);
    expect(sys).toMatch(/chiffre/);
    // Les autres patterns ne sont PAS dans le prompt.
    expect(sys).not.toMatch(/erreur-commune/);
  });

  it("injecte le contexte fixe (formateur CDA/DWWM, distanciel)", () => {
    const sys = buildSystemPrompt(theme(), defaultRegistry());
    expect(sys).toMatch(/CDA/);
    expect(sys).toMatch(/DWWM/);
    expect(sys).toMatch(/distanciel/);
  });

  it("interdits explicites du hook : « Voici 5 astuces », « Spoiler », « Et devinez quoi »", () => {
    const sys = buildSystemPrompt(theme(), defaultRegistry());
    expect(sys).toMatch(/Voici 5 astuces/);
    expect(sys).toMatch(/Spoiler/);
    expect(sys).toMatch(/devinez quoi/);
  });
});

describe("buildUserPrompt — anti-répétition §8.6", () => {
  it("injecte les 10 derniers posts, tronqués à 200 caractères, avec « change d'angle »", () => {
    const longContent = "x".repeat(400);
    const recent = Array.from({ length: 12 }, (_, i) => post(longContent, i));
    const user = buildUserPrompt(theme(), recent, defaultRegistry());

    // Consigne présente.
    expect(user).toMatch(/Ne reprends aucun de ces angles/);
    expect(user).toMatch(/Propose un sujet différent/);
    // Seuls les 10 premiers sont inclus.
    expect(user).toMatch(/\[10\]/);
    expect(user).not.toMatch(/\[11\]/);
    // Chaque bloc tronqué à 200 caractères + « … ».
    const excerpt = "x".repeat(200);
    expect(user).toContain(excerpt + "…");
    expect(user).not.toContain("x".repeat(201));
  });

  it("recentPosts vide → message explicite « Aucun post récent »", () => {
    const user = buildUserPrompt(theme(), [], defaultRegistry());
    expect(user).toMatch(/Aucun post récent/);
  });

  it("contient les exemples few-shot du thème", () => {
    const user = buildUserPrompt(theme(), [], defaultRegistry());
    expect(user).toContain("Exemple 1 — un post modèle.");
  });
});

describe("buildContractFragment — §8.7", () => {
  it("liste tous les champs du contrat", () => {
    const frag = buildContractFragment(theme(), defaultRegistry());
    expect(frag).toMatch(/"content"/);
    expect(frag).toMatch(/"hashtags"/);
    expect(frag).toMatch(/"firstComment"/);
    expect(frag).toMatch(/"visual"/);
    expect(frag).toMatch(/"carousel"/);
    expect(frag).toMatch(/"altText"/);
  });

  it("indique la fourchette de longueur dérivée", () => {
    const frag = buildContractFragment(theme(), defaultRegistry());
    expect(frag).toMatch(/900 à 1500/);
  });
});

describe("buildStandalonePrompt — §8.9", () => {
  it("contient les 6 éléments : contexte, règle dure, consignes thème, exemples, 10 derniers, contrat", () => {
    const recent = [post("post récent 1"), post("post récent 2")];
    const full = buildStandalonePrompt(theme(), recent, defaultRegistry());

    expect(full).toContain(LOCALIZATION_RULE); // règle dure
    expect(full).toMatch(/CDA/); // contexte
    expect(full).toMatch(/retours de terrain/); // consigne thème (systemPrompt)
    expect(full).toContain("Exemple 1 — un post modèle."); // exemples
    expect(full).toContain("post récent 1"); // anti-répétition
    expect(full).toMatch(/"content"/); // contrat
    expect(full).toMatch(/Réponds uniquement par le JSON/); // consigne finale
  });
});
