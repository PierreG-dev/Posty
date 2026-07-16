import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { DateTime } from "luxon";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SESSION_SECRET = "x".repeat(48);
process.env.AUTH_PASSWORD_HASH = Buffer.from("stub", "utf8").toString("base64");
process.env.MONGODB_URI = "mongodb://localhost:27017";
process.env.MONGODB_DB = "posty_test";

// ─── État partagé ────────────────────────────────────────────────────────────

let metas: Map<string, any> = new Map();
let enqueueCalls: Array<{ companyId: string; step: number }> = [];

vi.mock("@/modules/mailing/repositories/company-meta-repo", () => ({
  listMetaByIds: vi.fn(async (ids: string[]) => {
    const m = new Map<string, any>();
    for (const id of ids) if (metas.has(id)) m.set(id, metas.get(id));
    return m;
  }),
}));

vi.mock("@/modules/mailing/services/enqueue", () => ({
  enqueueSequence: vi.fn(async (company: any, step: number) => {
    enqueueCalls.push({ companyId: company.id, step });
    return { ok: true, duplicate: false, entryId: `id-${enqueueCalls.length}` };
  }),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

function twentyMockWithCompanies(items: any[]) {
  return {
    listCompanies: async () => ({ items, nextCursor: null }),
    getCompany: async (id: string) => items.find((c) => c.id === id) ?? null,
    patchCompany: async () => undefined,
    ping: async () => ({ ok: true as const }),
  } as any;
}

function co(overrides: any = {}) {
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
  metas = new Map();
  enqueueCalls = [];
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("eligibility — §5.3 CLIENT / PARTENAIRE non enfilés", () => {
  it("CLIENT et PARTENAIRE sont skippés, PROSPECT est enfilé", async () => {
    const twenty = twentyMockWithCompanies([
      co({ id: "cP", status: "PROSPECT" }),
      co({ id: "cC", status: "CLIENT" }),
      co({ id: "cX", status: "PARTENAIRE" }),
    ]);
    const { runEligibilityTick } = await import("@/modules/mailing/services/eligibility-tick");
    const r = await runEligibilityTick({ twenty });
    expect(enqueueCalls).toEqual([{ companyId: "cP", step: 0 }]);
    expect(r.enqueued).toBe(1);
    expect(r.skipped).toBe(2);
  });
});

describe("eligibility — meta.paused et hard bounce skippés", () => {
  it("meta.paused=true → skip", async () => {
    metas.set("cA", { paused: true });
    const twenty = twentyMockWithCompanies([co({ id: "cA" })]);
    const { runEligibilityTick } = await import("@/modules/mailing/services/eligibility-tick");
    await runEligibilityTick({ twenty });
    expect(enqueueCalls).toHaveLength(0);
  });
  it("meta.bounce.kind=hard → skip", async () => {
    metas.set("cA", { bounce: { kind: "hard" } });
    const twenty = twentyMockWithCompanies([co({ id: "cA" })]);
    const { runEligibilityTick } = await import("@/modules/mailing/services/eligibility-tick");
    await runEligibilityTick({ twenty });
    expect(enqueueCalls).toHaveLength(0);
  });
});

describe("eligibility — nextFollowupAt dans le futur skippé", () => {
  it("nextFollowupAt = J+3, today = J → skip", async () => {
    const now = new Date("2026-07-16T09:00:00Z");
    const future = DateTime.fromJSDate(now).plus({ days: 3 }).toUTC().toISO()!;
    const twenty = twentyMockWithCompanies([
      co({ id: "cA", followupCount: 1, nextFollowupAt: future }),
    ]);
    const { runEligibilityTick } = await import("@/modules/mailing/services/eligibility-tick");
    await runEligibilityTick({ twenty, now });
    expect(enqueueCalls).toHaveLength(0);
  });
  it("nextFollowupAt = J-1 → enfilé (step = followupCount)", async () => {
    const now = new Date("2026-07-16T09:00:00Z");
    const past = DateTime.fromJSDate(now).minus({ days: 1 }).toUTC().toISO()!;
    const twenty = twentyMockWithCompanies([
      co({ id: "cA", followupCount: 1, nextFollowupAt: past }),
    ]);
    const { runEligibilityTick } = await import("@/modules/mailing/services/eligibility-tick");
    await runEligibilityTick({ twenty, now });
    expect(enqueueCalls).toEqual([{ companyId: "cA", step: 1 }]);
  });
});

describe("eligibility — followupCount out of range", () => {
  it("followupCount=3 → skip (sortie de séquence)", async () => {
    const twenty = twentyMockWithCompanies([co({ followupCount: 3 })]);
    const { runEligibilityTick } = await import("@/modules/mailing/services/eligibility-tick");
    await runEligibilityTick({ twenty });
    expect(enqueueCalls).toHaveLength(0);
  });
});
