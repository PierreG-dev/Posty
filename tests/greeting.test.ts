import { describe, it, expect, vi, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.SESSION_SECRET = "x".repeat(48);
  process.env.AUTH_PASSWORD_HASH = Buffer.from("stub", "utf8").toString("base64");
  process.env.MONGODB_URI = "mongodb://localhost:27017";
  process.env.MONGODB_DB = "posty_test";
});

// Fake settings — évite d'ouvrir Mongo dans un test unitaire.
vi.mock("@/modules/mailing/repositories/mail-settings-repo", () => ({
  getMailSettings: async () => ({
    _id: "singleton",
    sendDays: [],
    dailyCap: 25,
    jitter: { minSeconds: 45, maxSeconds: 180 },
    sequence: { delays: [5, 9, 60], clientRelanceDays: 60 },
    smtp: { host: "", port: 587, secure: false, user: "", pass: "", from: "" },
    imap: { host: "", port: 993, user: "", pass: "", archiveFolder: "Posty" },
    twenty: { apiUrl: "" },
    greeting: {
      model: "claude-sonnet-4-6",
      temperature: 0,
      maxTokens: 100,
      systemPrompt: "SYSTEM",
    },
    bccLogs: null,
    paused: false,
    dryRun: true,
    updatedAt: new Date(),
  }),
}));

describe("generateGreeting", () => {
  it('renvoie "Bonjour," si le nom est vide', async () => {
    const { generateGreeting, GREETING_FALLBACK } = await import("@/modules/mailing/services/greeting");
    const r = await generateGreeting("");
    expect(r).toBe(GREETING_FALLBACK);
  });

  it("appelle Claude avec le systemPrompt et retourne la sortie nettoyée", async () => {
    const { generateGreeting } = await import("@/modules/mailing/services/greeting");
    const client = {
      call: vi.fn().mockResolvedValue({ text: "Bonjour l'équipe d'O'Clock,", model: "x" }),
    };
    const r = await generateGreeting("O'Clock", { client });
    expect(r).toBe("Bonjour l'équipe d'O'Clock,");
    const [args] = client.call.mock.calls[0]!;
    expect(args.system).toBe("SYSTEM");
    expect(args.user).toBe("O'Clock");
    expect(args.temperature).toBe(0);
    expect(args.maxTokens).toBe(100);
  });

  it("force une virgule finale si le modèle l'oublie", async () => {
    const { generateGreeting } = await import("@/modules/mailing/services/greeting");
    const client = { call: vi.fn().mockResolvedValue({ text: "Bonjour l'équipe d'X", model: "x" }) };
    const r = await generateGreeting("X", { client });
    expect(r).toBe("Bonjour l'équipe d'X,");
  });

  it("retire les guillemets et prend la 1re ligne non vide", async () => {
    const { generateGreeting } = await import("@/modules/mailing/services/greeting");
    const client = { call: vi.fn().mockResolvedValue({ text: '\n"Bonjour l\'équipe d\'Y,"\nautre chose', model: "x" }) };
    const r = await generateGreeting("Y", { client });
    expect(r).toBe("Bonjour l'équipe d'Y,");
  });

  it("ne throw JAMAIS et fallback en cas d'erreur API", async () => {
    const { generateGreeting, GREETING_FALLBACK } = await import("@/modules/mailing/services/greeting");
    const client = { call: vi.fn().mockRejectedValue(new Error("boom")) };
    const r = await generateGreeting("X", { client });
    expect(r).toBe(GREETING_FALLBACK);
  });

  it("fallback si la sortie est vide", async () => {
    const { generateGreeting, GREETING_FALLBACK } = await import("@/modules/mailing/services/greeting");
    const client = { call: vi.fn().mockResolvedValue({ text: "   \n  ", model: "x" }) };
    const r = await generateGreeting("X", { client });
    expect(r).toBe(GREETING_FALLBACK);
  });
});
