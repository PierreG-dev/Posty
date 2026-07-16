import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";

// Env applicatif AVANT tout import.
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SESSION_SECRET = "x".repeat(48);
process.env.AUTH_PASSWORD_HASH = Buffer.from("stub", "utf8").toString("base64");
process.env.MONGODB_URI = "mongodb://localhost:27017";
process.env.MONGODB_DB = "posty_test";
process.env.APP_URL = "http://localhost:3000";
process.env.ANTHROPIC_MODEL = "claude-sonnet-5";

import type { AnthropicClient } from "@/modules/linkedin/ai/anthropic-client";
import type { Theme } from "@/modules/linkedin/domain/theme";

const themeFix: Theme = {
  _id: "t1",
  name: "Pédagogie",
  slug: "pedagogie",
  color: "#FFB020",
  emoji: "",
  description: "",
  ai: {
    enabled: true,
    systemPrompt: "",
    structure: "",
    targetLength: null,
    hookPatterns: ["aveu"],
    examples: ["ex"],
    forbiddenPhrases: [],
  },
  visual: { mode: "none", templateId: null, carouselSlides: 5 },
  defaultHashtags: ["#dev"],
  active: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const createdPostsList: Array<Record<string, unknown>> = [];
vi.mock("@/modules/linkedin/repositories/theme-repo", () => ({
  getTheme: vi.fn(async () => themeFix),
}));
vi.mock("@/modules/linkedin/repositories/post-repo", () => ({
  listPosts: vi.fn(async () => []),
  createPost: vi.fn(async (input: Record<string, unknown>) => {
    const created = { _id: "createdPost" + createdPostsList.length, ...input };
    createdPostsList.push(created);
    return created;
  }),
  getPost: vi.fn(async (id: string) => ({ _id: id })),
}));
vi.mock("@/modules/linkedin/repositories/post-model", () => ({
  PostModel: { updateOne: vi.fn(async () => ({ modifiedCount: 1 })) },
}));
vi.mock("@/modules/shared/db/mongoose", () => ({
  connectDb: vi.fn(async () => undefined),
}));

// Contenu valide pour le validateur (mode none → 900-1500, hook ≤ 100).
const HOOK = "J'ai mis trois ans à comprendre.\n";
const OK_CONTENT = HOOK + "corps ".repeat(150) + "fin"; // ~950 chars

function fakePayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    content: OK_CONTENT,
    hashtags: ["#dev", "#formation", "#dwwm"],
    firstComment: null,
    visual: null,
    carousel: null,
    altText: "",
    ...overrides,
  });
}

function makeClient(responses: string[]): AnthropicClient {
  let i = 0;
  return {
    call: vi.fn(async () => {
      const text = responses[Math.min(i, responses.length - 1)] ?? "";
      i += 1;
      return { text, model: "claude-sonnet-5" };
    }),
  };
}

beforeEach(() => {
  createdPostsList.length = 0;
  vi.clearAllMocks();
});

describe("generatePost", () => {
  it("réponse valide au premier essai → variants[0].ok=true, 1 appel Claude", async () => {
    const client = makeClient([fakePayload()]);
    const { generatePost } = await import("@/modules/linkedin/services/generator");

    const r = await generatePost("t1", { variants: 1, persist: false, client });

    expect(r.variants).toHaveLength(1);
    expect(r.variants[0]!.ok).toBe(true);
    expect(client.call).toHaveBeenCalledTimes(1);
  });

  it("premier essai invalide → 1 retry avec l'erreur citée, réussit au 2e", async () => {
    const invalid = JSON.stringify({ content: "trop court", hashtags: ["#a"], visual: null, carousel: null, altText: "" });
    const client = makeClient([invalid, fakePayload()]);
    const { generatePost } = await import("@/modules/linkedin/services/generator");

    const r = await generatePost("t1", { variants: 1, persist: false, client });

    expect(client.call).toHaveBeenCalledTimes(2);
    // Le 2e appel doit mentionner l'erreur du 1er.
    const secondCall = (client.call as ReturnType<typeof vi.fn>).mock.calls[1]![0];
    expect(secondCall.user).toMatch(/rejeté par le validateur/i);
    expect(r.variants[0]!.ok).toBe(true);
    if (r.variants[0]!.ok) expect(r.variants[0]!.attempts).toBe(2);
  });

  it("deux essais invalides → variant.ok=false, attempts=2", async () => {
    const invalid = JSON.stringify({ content: "trop court", hashtags: ["#a"], visual: null, carousel: null, altText: "" });
    const client = makeClient([invalid, invalid]);
    const { generatePost } = await import("@/modules/linkedin/services/generator");

    const r = await generatePost("t1", { variants: 1, persist: false, client });

    expect(client.call).toHaveBeenCalledTimes(2);
    expect(r.variants[0]!.ok).toBe(false);
  });

  it("persist=false → aucun createPost appelé", async () => {
    const client = makeClient([fakePayload()]);
    const { generatePost } = await import("@/modules/linkedin/services/generator");
    const { createPost } = await import("@/modules/linkedin/repositories/post-repo");

    await generatePost("t1", { variants: 1, persist: false, client });

    expect(createPost).not.toHaveBeenCalled();
  });

  it("persist=true → createPost appelé avec source='ai' et status='draft'", async () => {
    const client = makeClient([fakePayload()]);
    const { generatePost } = await import("@/modules/linkedin/services/generator");
    const { createPost } = await import("@/modules/linkedin/repositories/post-repo");

    const r = await generatePost("t1", { variants: 1, persist: true, client });

    expect(createPost).toHaveBeenCalledTimes(1);
    const arg = (createPost as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.source).toBe("ai");
    expect(arg.status).toBe("draft"); // ne pollue pas la file
    expect(r.createdPosts).toHaveLength(1);
  });

  it("rejette une réponse en backticks (contrat §8.7)", async () => {
    const client = makeClient(["```json\n" + fakePayload() + "\n```"]);
    const { generatePost } = await import("@/modules/linkedin/services/generator");

    const r = await generatePost("t1", { variants: 1, persist: false, client });

    expect(r.variants[0]!.ok).toBe(false);
    if (!r.variants[0]!.ok) {
      expect(r.variants[0]!.errors[0]!.message).toMatch(/backticks/i);
    }
  });

  it("rejette une réponse avec préambule", async () => {
    const client = makeClient(["Voici : " + fakePayload()]);
    const { generatePost } = await import("@/modules/linkedin/services/generator");

    const r = await generatePost("t1", { variants: 1, persist: false, client });

    expect(r.variants[0]!.ok).toBe(false);
  });
});
