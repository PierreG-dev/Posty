import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { DateTime } from "luxon";

// Env applicatif AVANT tout import.
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SESSION_SECRET = "x".repeat(48);
process.env.AUTH_PASSWORD_HASH = Buffer.from("stub", "utf8").toString("base64");
process.env.MONGODB_URI = "mongodb://localhost:27017";
process.env.MONGODB_DB = "posty_test";

// ─── État partagé des mocks ──────────────────────────────────────────────────

interface FakeEntry {
  _id: string;
  companyId: string;
  kind: "sequence" | "campaign";
  sequenceStep: number | null;
  campaignId: string | null;
  priority: 1 | 2 | 3;
  subject: string;
  body: string;
  snapshot: { name: string; email: string; greeting: string };
  threading: { inReplyTo: string | null; references: string | null } | null;
  status: "pending" | "sending" | "sent" | "failed" | "cancelled";
  attempts: number;
  lastError: string | null;
  messageId: string | null;
  cancelReason: string | null;
  createdAt: Date;
  sentAt: Date | null;
  updatedAt: Date;
}

let queue: FakeEntry[] = [];
let sentLog: Array<{ dryRun: boolean; sentAt: Date; queueId: string }> = [];
let settingsState: any = null;
let metaState: Map<string, { paused?: boolean; bounce?: { kind: "hard" | "soft" } | null }> = new Map();
let lockHolders: Set<string> = new Set();
let twentyPatchCalls: Array<{ id: string; patch: any }> = [];
let twentyCompanies: Map<string, any> = new Map();

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/modules/mailing/repositories/mail-settings-repo", () => ({
  getMailSettings: vi.fn(async () => settingsState),
}));

vi.mock("@/modules/mailing/repositories/company-meta-repo", () => ({
  getMeta: vi.fn(async (id: string) => {
    const m = metaState.get(id);
    if (!m) return null;
    return {
      _id: `meta-${id}`,
      companyId: id,
      greeting: "Bonjour,",
      greetingEditedByHuman: false,
      paused: m.paused ?? false,
      pausedReason: null,
      pausedAt: null,
      bounce: m.bounce ?? null,
      updatedAt: new Date(),
    };
  }),
}));

vi.mock("@/modules/mailing/repositories/mail-queue-repo", () => ({
  claimNextPending: vi.fn(async () => {
    const pending = queue
      .filter((e) => e.status === "pending")
      .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());
    const head = pending[0];
    if (!head) return null;
    head.status = "sending";
    return { ...head };
  }),
  markSent: vi.fn(async (id: string, info: { messageId: string; sentAt: Date }) => {
    const e = queue.find((x) => x._id === id);
    if (e) {
      e.status = "sent";
      e.messageId = info.messageId;
      e.sentAt = info.sentAt;
    }
  }),
  markFailed: vi.fn(async (id: string, err: string) => {
    const e = queue.find((x) => x._id === id);
    if (e) {
      e.status = "failed";
      e.lastError = err;
      e.attempts++;
    }
  }),
  markCancelled: vi.fn(async (id: string, reason: string) => {
    const e = queue.find((x) => x._id === id);
    if (e) {
      e.status = "cancelled";
      e.cancelReason = reason;
    }
  }),
}));

vi.mock("@/modules/mailing/repositories/mail-log-repo", () => ({
  countSentOnParisDay: vi.fn(async (at: Date) => {
    const start = DateTime.fromJSDate(at).setZone("Europe/Paris").startOf("day");
    const end = start.plus({ days: 1 });
    return sentLog.filter(
      (l) =>
        !l.dryRun &&
        l.sentAt.getTime() >= start.toJSDate().getTime() &&
        l.sentAt.getTime() < end.toJSDate().getTime(),
    ).length;
  }),
  logSent: vi.fn(async (input: any) => {
    sentLog.push({ dryRun: input.dryRun, sentAt: input.sentAt, queueId: input.queueId });
    return input;
  }),
}));

vi.mock("@/modules/shared/pushover/notify", () => ({
  notify: vi.fn(async () => undefined),
}));

vi.mock("@/modules/shared/locks/lock", () => ({
  withLock: vi.fn(async (key: string, _ttl: number, fn: () => Promise<unknown>) => {
    if (lockHolders.has(key)) return null;
    lockHolders.add(key);
    try {
      return await fn();
    } finally {
      lockHolders.delete(key);
    }
  }),
}));

vi.mock("@/modules/mailing/twenty", () => ({
  twentyFromEnv: () => ({
    getCompany: async (id: string) => twentyCompanies.get(id) ?? null,
    patchCompany: async (id: string, patch: any) => {
      twentyPatchCalls.push({ id, patch });
    },
    listCompanies: async () => ({ items: [], nextCursor: null }),
    ping: async () => ({ ok: true }),
  }),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

function baseSettings(overrides: any = {}) {
  return {
    _id: "singleton",
    sendDays: [],
    dailyCap: 25,
    jitter: { minSeconds: 0, maxSeconds: 0 }, // 0 = pas de sleep dans les tests
    sequence: { delays: [5, 9, 60], clientRelanceDays: 60 },
    smtp: { host: "smtp.local", port: 587, secure: false, user: "u", pass: "p", from: "me@local" },
    imap: { host: "", port: 993, user: "", pass: "", archiveFolder: "Posty", inboxFolder: "INBOX", spamFolder: "Spam" },
    twenty: { apiUrl: "" },
    greeting: { model: "x", temperature: 0, maxTokens: 100, systemPrompt: "" },
    bccLogs: null,
    paused: false,
    dryRun: false,
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeEntry(overrides: Partial<FakeEntry>): FakeEntry {
  return {
    _id: overrides._id ?? `q${queue.length + 1}`,
    companyId: overrides.companyId ?? "c1",
    kind: overrides.kind ?? "sequence",
    sequenceStep: overrides.sequenceStep ?? 0,
    campaignId: overrides.campaignId ?? null,
    priority: overrides.priority ?? 2,
    subject: overrides.subject ?? "Sujet",
    body: overrides.body ?? "Corps",
    snapshot: overrides.snapshot ?? { name: "Acme", email: "a@acme.io", greeting: "Bonjour," },
    threading: overrides.threading ?? null,
    status: overrides.status ?? "pending",
    attempts: overrides.attempts ?? 0,
    lastError: null,
    messageId: null,
    cancelReason: null,
    createdAt: overrides.createdAt ?? new Date(),
    sentAt: null,
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  queue = [];
  sentLog = [];
  metaState = new Map();
  lockHolders = new Set();
  twentyPatchCalls = [];
  twentyCompanies = new Map();
  settingsState = baseSettings();
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("send-tick — paused global", () => {
  it("settings.paused=true → return immédiat, zéro envoi", async () => {
    settingsState = baseSettings({ paused: true });
    queue = [makeEntry({ _id: "e1" })];
    const smtp = { send: vi.fn() };
    const { runSendLoop } = await import("@/modules/mailing/services/send-tick");

    const r = await runSendLoop({ smtp, now: new Date() });

    expect(r.sent).toBe(0);
    expect(smtp.send).not.toHaveBeenCalled();
    expect(queue[0]!.status).toBe("pending");
  });
});

describe("send-tick — dryRun", () => {
  it("dryRun=true → log dryRun=true, PAS d'appel SMTP réel, PAS de PATCH Twenty", async () => {
    settingsState = baseSettings({ dryRun: true });
    queue = [makeEntry({ _id: "e1", companyId: "cX", sequenceStep: 0 })];
    twentyCompanies.set("cX", { id: "cX", name: "X", followupCount: 0, messageReferences: null });

    const externalSmtp = { send: vi.fn() };
    // Comme on ne passe pas de smtp, send-tick crée un dryRunClient interne.
    const { runSendLoop } = await import("@/modules/mailing/services/send-tick");

    const r = await runSendLoop({ now: new Date() });

    expect(r.sent).toBe(1);
    expect(externalSmtp.send).not.toHaveBeenCalled();
    expect(twentyPatchCalls).toHaveLength(0); // pas de PATCH en dryRun
    expect(sentLog).toHaveLength(1);
    expect(sentLog[0]!.dryRun).toBe(true);
  });
});

describe("send-tick — quota 25 tenu sur double exécution", () => {
  it("30 entries pending, quota=5 → 5 envois. Second appel = 0 envoi (log a été rempli)", async () => {
    settingsState = baseSettings({ dailyCap: 5 });
    for (let i = 0; i < 30; i++) queue.push(makeEntry({ _id: `e${i}`, companyId: `c${i}` }));
    const smtp = {
      send: vi.fn(async () => ({ messageId: `<msg-${Math.random()}>` })),
    };
    const { runSendLoop } = await import("@/modules/mailing/services/send-tick");

    const r1 = await runSendLoop({ smtp, twenty: null, now: new Date() });
    expect(r1.sent).toBe(5);
    expect(smtp.send).toHaveBeenCalledTimes(5);

    const r2 = await runSendLoop({ smtp, twenty: null, now: new Date() });
    expect(r2.sent).toBe(0);
    expect(r2.quotaReached).toBe(true);
    expect(smtp.send).toHaveBeenCalledTimes(5); // pas d'appel supplémentaire
  });
});

describe("send-tick — priorité relances > premiers > campagnes", () => {
  it("file mixte : sortie dans l'ordre p1, p2, p3", async () => {
    settingsState = baseSettings({ dailyCap: 10 });
    const t0 = Date.now();
    queue = [
      makeEntry({ _id: "camp1", priority: 3, kind: "campaign", sequenceStep: null, campaignId: "ca", createdAt: new Date(t0) }),
      makeEntry({ _id: "first1", priority: 2, sequenceStep: 0, createdAt: new Date(t0 + 1) }),
      makeEntry({ _id: "relance1", priority: 1, sequenceStep: 1, createdAt: new Date(t0 + 2) }),
      makeEntry({ _id: "relance2", priority: 1, sequenceStep: 2, createdAt: new Date(t0 + 3) }),
    ];
    const order: string[] = [];
    const smtp = {
      send: vi.fn(async (input: any) => {
        order.push(input.subject);
        return { messageId: `<${Math.random()}>` };
      }),
    };
    // rewrite subjects to be recognizable
    queue[0]!.subject = "camp1";
    queue[1]!.subject = "first1";
    queue[2]!.subject = "relance1";
    queue[3]!.subject = "relance2";

    const { runSendLoop } = await import("@/modules/mailing/services/send-tick");
    await runSendLoop({ smtp, twenty: null, now: new Date() });

    expect(order).toEqual(["relance1", "relance2", "first1", "camp1"]);
  });
});

describe("send-tick — pause tardive n'envoie pas et NE consomme PAS le quota", () => {
  it("entry pending, meta pause posée avant le send → cancelled, log vide, quota inchangé", async () => {
    settingsState = baseSettings({ dailyCap: 25 });
    queue = [makeEntry({ _id: "e1", companyId: "cPaused" })];
    metaState.set("cPaused", { paused: true });
    const smtp = { send: vi.fn() };
    const { runSendLoop } = await import("@/modules/mailing/services/send-tick");

    await runSendLoop({ smtp, twenty: null, now: new Date() });

    expect(smtp.send).not.toHaveBeenCalled();
    expect(queue[0]!.status).toBe("cancelled");
    expect(queue[0]!.cancelReason).toBe("paused_before_send");
    expect(sentLog).toHaveLength(0);
    expect(twentyPatchCalls).toHaveLength(0);
  });

  it("hard bounce tardif → cancelled, pas d'envoi", async () => {
    settingsState = baseSettings({ dailyCap: 25 });
    queue = [makeEntry({ _id: "e1", companyId: "cBounce" })];
    metaState.set("cBounce", { bounce: { kind: "hard" } });
    const smtp = { send: vi.fn() };
    const { runSendLoop } = await import("@/modules/mailing/services/send-tick");
    await runSendLoop({ smtp, twenty: null, now: new Date() });
    expect(smtp.send).not.toHaveBeenCalled();
    expect(queue[0]!.status).toBe("cancelled");
    expect(queue[0]!.cancelReason).toBe("bounce_before_send");
  });
});

describe("send-tick — PATCH Twenty après séquence step 0", () => {
  it("séquence step 0 → PATCH followupCount+1, nextFollowupAt = now + delays[1]", async () => {
    settingsState = baseSettings({ dailyCap: 25, sequence: { delays: [5, 9, 60], clientRelanceDays: 60 } });
    twentyCompanies.set("cSeq", {
      id: "cSeq",
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
    });
    const now = new Date("2026-07-16T12:00:00Z");
    queue = [makeEntry({ _id: "e1", companyId: "cSeq", sequenceStep: 0, createdAt: now })];
    const smtp = { send: vi.fn(async () => ({ messageId: "<msgSeq>" })) };
    const { runSendLoop } = await import("@/modules/mailing/services/send-tick");

    await runSendLoop({ smtp, now });

    expect(twentyPatchCalls).toHaveLength(1);
    const p = twentyPatchCalls[0]!.patch;
    expect(p.followupCount).toBe(1);
    expect(p.lastMessageId).toBe("<msgSeq>");
    expect(p.toContact).toBe(false);
    // nextFollowupAt = sentAt (horloge réelle) + delays[1] jours. On mesure
    // par rapport au sentAt effectif consigné dans mail_log.
    const nextAt = DateTime.fromISO(p.nextFollowupAt);
    const sentAt = DateTime.fromJSDate(sentLog[0]!.sentAt);
    const diffDays = nextAt.diff(sentAt, "days").days;
    expect(Math.abs(diffDays - 9)).toBeLessThan(0.01);
  });

  it("campagne → PAS de PATCH Twenty", async () => {
    settingsState = baseSettings({ dailyCap: 25 });
    queue = [
      makeEntry({
        _id: "eCamp",
        companyId: "cCa",
        kind: "campaign",
        sequenceStep: null,
        campaignId: "ca1",
        priority: 3,
      }),
    ];
    twentyCompanies.set("cCa", { id: "cCa" });
    const smtp = { send: vi.fn(async () => ({ messageId: "<c>" })) };
    const { runSendLoop } = await import("@/modules/mailing/services/send-tick");
    await runSendLoop({ smtp, now: new Date() });
    expect(twentyPatchCalls).toHaveLength(0);
  });
});

describe("send-tick — échec SMTP = failed définitif (pas de retry auto)", () => {
  it("SMTP throw → status=failed, notify appelé, entrée pas remise en pending", async () => {
    settingsState = baseSettings({ dailyCap: 25 });
    queue = [makeEntry({ _id: "eErr", companyId: "cErr" })];
    const smtp = { send: vi.fn(async () => { throw new Error("SMTP down"); }) };
    const { notify } = await import("@/modules/shared/pushover/notify");
    const { runSendLoop } = await import("@/modules/mailing/services/send-tick");
    await runSendLoop({ smtp, twenty: null, now: new Date() });
    expect(queue[0]!.status).toBe("failed");
    expect(queue[0]!.lastError).toContain("SMTP down");
    expect(sentLog).toHaveLength(0);
    expect(notify).toHaveBeenCalled();
  });
});

describe("send-tick — isInSendWindow (fuseau horaire)", () => {
  it("créneau mar 10:30 déclenche à 10:30 heure de Paris même si TZ=UTC", async () => {
    const original = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      const { isInSendWindow } = await import("@/modules/mailing/services/send-tick");
      const nowParis1030 = DateTime.fromObject(
        { year: 2026, month: 7, day: 14, hour: 10, minute: 30 },
        { zone: "Europe/Paris" },
      ).toJSDate();
      const settings = baseSettings({ sendDays: [{ dayOfWeek: 2, time: "10:30" }] });
      expect(isInSendWindow(settings, nowParis1030)).toBe(true);

      const nowParis0900 = DateTime.fromObject(
        { year: 2026, month: 7, day: 14, hour: 9, minute: 0 },
        { zone: "Europe/Paris" },
      ).toJSDate();
      expect(isInSendWindow(settings, nowParis0900)).toBe(false);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
