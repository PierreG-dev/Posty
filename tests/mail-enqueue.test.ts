import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SESSION_SECRET = "x".repeat(48);
process.env.AUTH_PASSWORD_HASH = Buffer.from("stub", "utf8").toString("base64");
process.env.MONGODB_URI = "mongodb://localhost:27017";
process.env.MONGODB_DB = "posty_test";

// ─── État partagé ────────────────────────────────────────────────────────────

interface Inserted {
  companyId: string;
  kind: "sequence" | "campaign";
  sequenceStep: number | null;
  campaignId: string | null;
  subject: string;
  body: string;
  snapshot: { name: string; email: string; greeting: string };
  threading: { inReplyTo: string | null; references: string | null } | null;
  priority: 1 | 2 | 3;
}

let inserted: Inserted[] = [];
let seenKeys: Set<string> = new Set();
let greetings: Map<string, string> = new Map();

function keyOf(input: Inserted): string {
  if (input.kind === "sequence") return `seq:${input.companyId}:${input.sequenceStep}`;
  return `camp:${input.companyId}:${input.campaignId}`;
}

vi.mock("@/modules/mailing/repositories/mail-queue-repo", () => ({
  enqueue: vi.fn(async (input: Inserted) => {
    const k = keyOf(input);
    if (seenKeys.has(k)) return { duplicate: true };
    seenKeys.add(k);
    inserted.push(input);
    return {
      duplicate: false,
      entry: { _id: `id-${inserted.length}`, ...input, status: "pending", attempts: 0 },
    };
  }),
}));

vi.mock("@/modules/mailing/repositories/mail-blocks-repo", () => ({
  listBlocksByIds: vi.fn(async () => [
    { _id: "b1", name: "signature", kind: "signature", content: "-- Signature --", isDefault: true, createdAt: new Date(), updatedAt: new Date() },
  ]),
}));

vi.mock("@/modules/mailing/repositories/mail-templates-repo", () => ({
  getTemplateByStep: vi.fn(async (step: number) => ({
    _id: `t${step}`,
    step,
    subject: `Sujet step ${step}`,
    body: `{{GREETING}}\n\nBody step ${step}\n\n{{BLOCK:signature}}`,
    blockIds: ["b1"],
    updatedAt: new Date(),
  })),
}));

vi.mock("@/modules/mailing/repositories/mail-settings-repo", () => ({
  getMailSettings: vi.fn(async () => ({
    _id: "singleton",
    sendDays: [],
    dailyCap: 25,
    jitter: { minSeconds: 0, maxSeconds: 0 },
    sequence: { delays: [5, 9, 60], clientRelanceDays: 60 },
    smtp: { host: "", port: 587, secure: false, user: "", pass: "", from: "" },
    imap: { host: "", port: 993, user: "", pass: "", archiveFolder: "Posty", inboxFolder: "INBOX", spamFolder: "Spam" },
    twenty: { apiUrl: "" },
    greeting: { model: "x", temperature: 0, maxTokens: 100, systemPrompt: "" },
    bccLogs: null,
    paused: false,
    dryRun: false,
    updatedAt: new Date(),
  })),
}));

vi.mock("@/modules/mailing/services/greeting", () => ({
  GREETING_FALLBACK: "Bonjour,",
  getOrCreateGreeting: vi.fn(async (companyId: string) => {
    return greetings.get(companyId) ?? "Bonjour,";
  }),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

function company(overrides: any = {}) {
  return {
    id: "cA",
    name: "Acme",
    status: "PROSPECT",
    isAutoHandled: true,
    toContact: true,
    followupCount: 0,
    lastContactedAt: null,
    nextFollowupAt: null,
    lastMessageId: null,
    messageReferences: null,
    contactEmail: { primaryEmail: "a@acme.io" },
    ...overrides,
  };
}

beforeEach(() => {
  inserted = [];
  seenKeys = new Set();
  greetings = new Map();
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("enqueueSequence — anti-doublon", () => {
  it("deux appels sur (companyId, step) → 1 entrée insérée, 2e = duplicate", async () => {
    const { enqueueSequence } = await import("@/modules/mailing/services/enqueue");
    const r1 = await enqueueSequence(company(), 0);
    const r2 = await enqueueSequence(company(), 0);
    expect(r1).toMatchObject({ ok: true, duplicate: false });
    expect(r2).toMatchObject({ ok: true, duplicate: true });
    expect(inserted).toHaveLength(1);
  });
});

describe("enqueueSequence — snapshot figé", () => {
  it("la salutation stockée dans snapshot est celle du moment de l'enqueue", async () => {
    greetings.set("cA", "Bonjour l'équipe d'Acme,");
    const { enqueueSequence } = await import("@/modules/mailing/services/enqueue");
    await enqueueSequence(company(), 0);
    expect(inserted[0]!.snapshot.greeting).toBe("Bonjour l'équipe d'Acme,");
    expect(inserted[0]!.body).toContain("Bonjour l'équipe d'Acme,");
    expect(inserted[0]!.body).toContain("-- Signature --");
  });
});

describe("enqueueSequence — priorité selon step", () => {
  it("step 0 = priority 2 (premier contact)", async () => {
    const { enqueueSequence } = await import("@/modules/mailing/services/enqueue");
    await enqueueSequence(company(), 0);
    expect(inserted[0]!.priority).toBe(2);
  });
  it("step 1 = priority 1 (relance)", async () => {
    const { enqueueSequence } = await import("@/modules/mailing/services/enqueue");
    await enqueueSequence(company({ id: "cB" }), 1);
    expect(inserted[0]!.priority).toBe(1);
  });
  it("step 2 = priority 1 (relance)", async () => {
    const { enqueueSequence } = await import("@/modules/mailing/services/enqueue");
    await enqueueSequence(company({ id: "cC" }), 2);
    expect(inserted[0]!.priority).toBe(1);
  });
});

describe("enqueueSequence — threading", () => {
  it("step 0 → threading=null (nouveau fil)", async () => {
    const { enqueueSequence } = await import("@/modules/mailing/services/enqueue");
    await enqueueSequence(company({ lastMessageId: "<prev>", messageReferences: "<prev>" }), 0);
    expect(inserted[0]!.threading).toBeNull();
  });
  it("step 1 → threading avec inReplyTo/references du fil précédent", async () => {
    const { enqueueSequence } = await import("@/modules/mailing/services/enqueue");
    await enqueueSequence(
      company({ id: "cX", lastMessageId: "<prev>", messageReferences: "<prev>" }),
      1,
    );
    expect(inserted[0]!.threading).toEqual({ inReplyTo: "<prev>", references: "<prev>" });
  });
});

describe("enqueueSequence — pas d'email", () => {
  it("contact sans email → refus explicite, aucune entrée insérée", async () => {
    const { enqueueSequence } = await import("@/modules/mailing/services/enqueue");
    const r = await enqueueSequence(company({ contactEmail: null }), 0);
    expect(r).toMatchObject({ ok: false, reason: "no_email" });
    expect(inserted).toHaveLength(0);
  });
});
