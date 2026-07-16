import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import type { ImapMessage } from "@/modules/mailing/services/imap";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SESSION_SECRET = "x".repeat(48);
process.env.AUTH_PASSWORD_HASH = Buffer.from("stub", "utf8").toString("base64");
process.env.MONGODB_URI = "mongodb://localhost:27017";
process.env.MONGODB_DB = "posty_test";

// CDC-02 §8 — critères d'acceptation couverts ici :
//  - Un hard bounce sort le contact de l'auto (isAutoHandled=false) + annule
//    ses entrées en file + Pushover.
//  - 3× soft consécutifs → traité comme hard.
//  - Une réponse pause le contact SANS changer son statut, annule ses
//    entrées, Pushover.
//  - Le watermark UID empêche de retraiter un message déjà vu.

// ─── État simulé ────────────────────────────────────────────────────────────

interface FakeMeta {
  companyId: string;
  paused?: boolean;
  pausedReason?: "reply" | "manual" | null;
  bounce?: { kind: "hard" | "soft"; count: number; lastCode: string; lastAt: Date } | null;
}

let metas: Map<string, FakeMeta> = new Map();
let cancelledForCompany: string[] = [];
let twentyPatchCalls: Array<{ id: string; patch: any }> = [];
let logsByEmail: Map<string, { companyId: string; toEmail: string; sentAt: Date; _id: string }> = new Map();
let logsByMessageId: Map<string, { companyId: string; toEmail: string; sentAt: Date; _id: string }> = new Map();
let watermark: Map<string, { uidValidity: number; lastUid: number }> = new Map();
let notifyCalls: string[] = [];

vi.mock("@/modules/mailing/repositories/mail-settings-repo", () => ({
  getMailSettings: vi.fn(async () => ({
    _id: "singleton",
    sendDays: [],
    dailyCap: 25,
    jitter: { minSeconds: 0, maxSeconds: 0 },
    sequence: { delays: [5, 9, 60], clientRelanceDays: 60 },
    smtp: { host: "", port: 587, secure: false, user: "", pass: "", from: "me@pierre-godino.com" },
    imap: {
      host: "imap.local",
      port: 993,
      user: "u",
      pass: "p",
      archiveFolder: "Posty",
      inboxFolder: "INBOX",
      spamFolder: "Spam",
    },
    twenty: { apiUrl: "" },
    greeting: { model: "x", temperature: 0, maxTokens: 100, systemPrompt: "" },
    bccLogs: null,
    paused: false,
    dryRun: false,
    updatedAt: new Date(),
  })),
}));

vi.mock("@/modules/mailing/repositories/company-meta-repo", () => ({
  getMeta: vi.fn(async (id: string) => {
    const m = metas.get(id);
    if (!m) return null;
    return {
      _id: `meta-${id}`,
      companyId: id,
      greeting: null,
      greetingEditedByHuman: false,
      paused: m.paused ?? false,
      pausedReason: m.pausedReason ?? null,
      pausedAt: m.paused ? new Date() : null,
      bounce: m.bounce ?? null,
      updatedAt: new Date(),
    };
  }),
  setBounce: vi.fn(async (companyId: string, bounce: any) => {
    const cur = metas.get(companyId) ?? { companyId };
    metas.set(companyId, { ...cur, bounce });
  }),
  setPaused: vi.fn(async (companyId: string, paused: boolean, reason: any) => {
    const cur = metas.get(companyId) ?? { companyId };
    metas.set(companyId, { ...cur, paused, pausedReason: reason });
  }),
}));

vi.mock("@/modules/mailing/repositories/mail-queue-repo", () => ({
  cancelPendingForCompany: vi.fn(async (companyId: string) => {
    cancelledForCompany.push(companyId);
    return 1;
  }),
}));

vi.mock("@/modules/mailing/repositories/mail-log-repo", () => ({
  findLastLogByEmail: vi.fn(async (email: string) => logsByEmail.get(email.toLowerCase()) ?? null),
  findAnyLogByMessageIds: vi.fn(async (ids: string[]) => {
    for (const id of ids) {
      const l = logsByMessageId.get(id);
      if (l) return l;
    }
    return null;
  }),
}));

vi.mock("@/modules/mailing/repositories/mail-imap-state-repo", () => ({
  getFolderState: vi.fn(async (folder: string) => watermark.get(folder) ?? null),
  reconcileFolder: vi.fn(async (folder: string, uidValidity: number) => {
    const cur = watermark.get(folder);
    if (!cur || cur.uidValidity !== uidValidity) {
      const next = { uidValidity, lastUid: 0 };
      watermark.set(folder, next);
      return next;
    }
    return cur;
  }),
  setFolderLastUid: vi.fn(async (folder: string, lastUid: number) => {
    const cur = watermark.get(folder);
    if (cur) cur.lastUid = lastUid;
  }),
}));

vi.mock("@/modules/shared/pushover/notify", () => ({
  notify: vi.fn(async (title: string, message: string) => {
    notifyCalls.push(message);
  }),
}));

vi.mock("@/modules/mailing/twenty", () => ({
  twentyFromEnv: () => ({
    getCompany: async () => null,
    patchCompany: async (id: string, patch: any) => {
      twentyPatchCalls.push({ id, patch });
    },
    listCompanies: async () => ({ items: [], nextCursor: null }),
    ping: async () => ({ ok: true }),
  }),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkMessage(partial: Partial<ImapMessage> & { uid: number }): ImapMessage {
  return {
    uid: partial.uid,
    headers: partial.headers ?? {},
    from: partial.from ?? "someone@external.com",
    to: partial.to ?? ["me@pierre-godino.com"],
    subject: partial.subject ?? "sub",
    messageId: partial.messageId ?? `msg-${partial.uid}@x`,
    inReplyTo: partial.inReplyTo ?? null,
    references: partial.references ?? [],
    contentType: partial.contentType ?? "text/plain",
    body: partial.body ?? "",
    date: partial.date ?? null,
  };
}

function dsnMessage(uid: number, email: string, status: string): ImapMessage {
  return mkMessage({
    uid,
    from: "mailer-daemon@example.com",
    contentType: "multipart/report; report-type=delivery-status",
    body: `\nContent-Type: message/delivery-status\n\nFinal-Recipient: rfc822; ${email}\nStatus: ${status}\nDiagnostic-Code: smtp; 550 test\n`,
  });
}

function mockImapClient(byFolder: Record<string, { uidValidity: number; messages: ImapMessage[] }>) {
  return {
    ensureFolder: vi.fn(),
    append: vi.fn(),
    fetchNewMessages: vi.fn(async ({ folder }: { folder: string }) => {
      return byFolder[folder] ?? { uidValidity: 1, messages: [] };
    }),
    close: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  metas = new Map();
  cancelledForCompany = [];
  twentyPatchCalls = [];
  logsByEmail = new Map();
  logsByMessageId = new Map();
  watermark = new Map();
  notifyCalls = [];
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("imap-inspect — bounces", () => {
  it("hard bounce (5.1.1) → setBounce hard + isAutoHandled=false + cancel + Pushover", async () => {
    logsByEmail.set("nobody@ghost.tld", {
      companyId: "c-ghost",
      toEmail: "nobody@ghost.tld",
      sentAt: new Date(),
      _id: "l1",
    });
    const imap = mockImapClient({
      INBOX: { uidValidity: 1, messages: [dsnMessage(10, "nobody@ghost.tld", "5.1.1")] },
    });
    const { runImapInspect } = await import("@/modules/mailing/services/imap-inspect-tick");
    const r = await runImapInspect({ imap });

    expect(r.bouncesHard).toBe(1);
    expect(metas.get("c-ghost")?.bounce?.kind).toBe("hard");
    expect(twentyPatchCalls).toEqual([{ id: "c-ghost", patch: { isAutoHandled: false } }]);
    expect(cancelledForCompany).toEqual(["c-ghost"]);
    expect(notifyCalls.some((m) => m.includes("Hard bounce"))).toBe(true);
  });

  it("3× soft bounces consécutifs → traité comme hard", async () => {
    logsByEmail.set("slow@x.tld", {
      companyId: "c-slow",
      toEmail: "slow@x.tld",
      sentAt: new Date(),
      _id: "l2",
    });
    const { runImapInspect } = await import("@/modules/mailing/services/imap-inspect-tick");

    // Run 1 — soft #1
    watermark.set("INBOX", { uidValidity: 1, lastUid: 0 });
    watermark.set("Spam", { uidValidity: 1, lastUid: 0 });
    await runImapInspect({
      imap: mockImapClient({ INBOX: { uidValidity: 1, messages: [dsnMessage(1, "slow@x.tld", "4.2.0")] } }),
    });
    expect(metas.get("c-slow")?.bounce?.kind).toBe("soft");
    expect(metas.get("c-slow")?.bounce?.count).toBe(1);

    // Run 2 — soft #2
    await runImapInspect({
      imap: mockImapClient({ INBOX: { uidValidity: 1, messages: [dsnMessage(2, "slow@x.tld", "4.2.0")] } }),
    });
    expect(metas.get("c-slow")?.bounce?.count).toBe(2);
    expect(twentyPatchCalls).toHaveLength(0);

    // Run 3 — soft #3 → escalade hard
    await runImapInspect({
      imap: mockImapClient({ INBOX: { uidValidity: 1, messages: [dsnMessage(3, "slow@x.tld", "4.2.0")] } }),
    });
    expect(metas.get("c-slow")?.bounce?.kind).toBe("hard");
    expect(twentyPatchCalls).toEqual([{ id: "c-slow", patch: { isAutoHandled: false } }]);
  });
});

describe("imap-inspect — réponses", () => {
  it("In-Reply-To d'un messageId Posty → paused=reply, cancel, notif, PAS de PATCH Twenty", async () => {
    logsByMessageId.set("orig@posty.local", {
      companyId: "c-acme",
      toEmail: "prospect@acme.io",
      sentAt: new Date(),
      _id: "l3",
    });
    const imap = mockImapClient({
      INBOX: {
        uidValidity: 1,
        messages: [
          mkMessage({
            uid: 5,
            from: "prospect@acme.io",
            inReplyTo: "orig@posty.local",
            contentType: "text/plain",
            body: "Merci de votre message.",
          }),
        ],
      },
    });
    const { runImapInspect } = await import("@/modules/mailing/services/imap-inspect-tick");
    const r = await runImapInspect({ imap });

    expect(r.replies).toBe(1);
    expect(metas.get("c-acme")?.paused).toBe(true);
    expect(metas.get("c-acme")?.pausedReason).toBe("reply");
    expect(cancelledForCompany).toEqual(["c-acme"]);
    expect(twentyPatchCalls).toHaveLength(0); // ← critère : aucun statut auto
    expect(notifyCalls.some((m) => m.includes("a répondu"))).toBe(true);
  });

  it("réponse déjà traitée (meta.paused=reply) → pas de re-notif ni re-cancel", async () => {
    logsByMessageId.set("orig@posty.local", {
      companyId: "c-acme",
      toEmail: "prospect@acme.io",
      sentAt: new Date(),
      _id: "l4",
    });
    metas.set("c-acme", { companyId: "c-acme", paused: true, pausedReason: "reply" });

    const imap = mockImapClient({
      INBOX: {
        uidValidity: 1,
        messages: [
          mkMessage({ uid: 5, from: "prospect@acme.io", inReplyTo: "orig@posty.local", body: "hi" }),
        ],
      },
    });
    const { runImapInspect } = await import("@/modules/mailing/services/imap-inspect-tick");
    const r = await runImapInspect({ imap });
    expect(r.replies).toBe(0);
    expect(notifyCalls).toHaveLength(0);
    expect(cancelledForCompany).toHaveLength(0);
  });

  it("message provenant de soi-même (own from) est ignoré", async () => {
    const imap = mockImapClient({
      INBOX: {
        uidValidity: 1,
        messages: [
          mkMessage({ uid: 9, from: "me@pierre-godino.com", body: "auto-loop" }),
        ],
      },
    });
    const { runImapInspect } = await import("@/modules/mailing/services/imap-inspect-tick");
    const r = await runImapInspect({ imap });
    expect(r.replies).toBe(0);
  });
});

describe("imap-inspect — watermark", () => {
  it("un second run sur les mêmes UIDs ne retraite pas", async () => {
    logsByEmail.set("nobody@ghost.tld", {
      companyId: "c-ghost",
      toEmail: "nobody@ghost.tld",
      sentAt: new Date(),
      _id: "l5",
    });
    const messages = [dsnMessage(3, "nobody@ghost.tld", "5.1.1")];
    const imap1 = mockImapClient({ INBOX: { uidValidity: 42, messages } });
    const { runImapInspect } = await import("@/modules/mailing/services/imap-inspect-tick");
    const r1 = await runImapInspect({ imap: imap1 });
    expect(r1.bouncesHard).toBe(1);
    expect(watermark.get("INBOX")?.lastUid).toBe(3);

    twentyPatchCalls = [];
    cancelledForCompany = [];
    notifyCalls = [];
    const imap2 = mockImapClient({ INBOX: { uidValidity: 42, messages } });
    const r2 = await runImapInspect({ imap: imap2 });
    // Le fetch renvoie les mêmes UIDs, mais le filtre `uid > sinceUid` les
    // écarte tous.
    expect(r2.bouncesHard).toBe(0);
    expect(twentyPatchCalls).toHaveLength(0);
    expect(cancelledForCompany).toHaveLength(0);
  });

  it("UIDVALIDITY change → reset watermark, message rescanné", async () => {
    logsByEmail.set("nobody@ghost.tld", {
      companyId: "c-ghost",
      toEmail: "nobody@ghost.tld",
      sentAt: new Date(),
      _id: "l6",
    });
    watermark.set("INBOX", { uidValidity: 42, lastUid: 100 });

    const imap = mockImapClient({
      INBOX: { uidValidity: 99, messages: [dsnMessage(1, "nobody@ghost.tld", "5.1.1")] },
    });
    const { runImapInspect } = await import("@/modules/mailing/services/imap-inspect-tick");
    const r = await runImapInspect({ imap });
    expect(r.bouncesHard).toBe(1);
    expect(watermark.get("INBOX")?.uidValidity).toBe(99);
  });
});
