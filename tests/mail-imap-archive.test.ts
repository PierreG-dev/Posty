import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SESSION_SECRET = "x".repeat(48);
process.env.AUTH_PASSWORD_HASH = Buffer.from("stub", "utf8").toString("base64");
process.env.MONGODB_URI = "mongodb://localhost:27017";
process.env.MONGODB_DB = "posty_test";

// §7.2 — critère d'acceptation critique du lot : si l'APPEND IMAP échoue, le
// mail EST déjà parti. Aucun renvoi. logSent/markSent doivent rester
// inchangés ; seul `imapArchived=false` est posé sur le log ; le smtp.send
// n'est PAS rappelé.

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
  threading: null;
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
let sentLog: Array<{ _id: string; imapArchived: boolean; queueId: string }> = [];
let archiveMarks: Array<{ logId: string; archived: boolean }> = [];
let logCounter = 0;

vi.mock("@/modules/mailing/repositories/mail-settings-repo", () => ({
  getMailSettings: vi.fn(async () => ({
    _id: "singleton",
    sendDays: [],
    dailyCap: 25,
    jitter: { minSeconds: 0, maxSeconds: 0 },
    sequence: { delays: [5, 9, 60], clientRelanceDays: 60 },
    smtp: { host: "smtp.local", port: 587, secure: false, user: "u", pass: "p", from: "me@local" },
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
  getMeta: vi.fn(async () => null),
}));

vi.mock("@/modules/mailing/repositories/mail-queue-repo", () => ({
  claimNextPending: vi.fn(async () => {
    const head = queue.find((e) => e.status === "pending");
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
  markFailed: vi.fn(),
  markCancelled: vi.fn(),
}));

vi.mock("@/modules/mailing/repositories/mail-log-repo", () => ({
  countSentOnParisDay: vi.fn(async () => sentLog.length),
  logSent: vi.fn(async (input: any) => {
    logCounter++;
    const entry = { _id: `log${logCounter}`, imapArchived: false, queueId: input.queueId };
    sentLog.push(entry);
    return { ...input, _id: entry._id, imapArchived: false };
  }),
  markLogImapArchived: vi.fn(async (logId: string, archived: boolean) => {
    archiveMarks.push({ logId, archived });
    const e = sentLog.find((l) => l._id === logId);
    if (e) e.imapArchived = archived;
  }),
}));

vi.mock("@/modules/shared/pushover/notify", () => ({ notify: vi.fn(async () => undefined) }));

vi.mock("@/modules/shared/locks/lock", () => ({
  withLock: vi.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/modules/mailing/twenty", () => ({
  twentyFromEnv: () => null,
}));

beforeEach(() => {
  queue = [];
  sentLog = [];
  archiveMarks = [];
  logCounter = 0;
  vi.clearAllMocks();
});

function entry(): FakeEntry {
  return {
    _id: "q1",
    companyId: "c1",
    kind: "sequence",
    sequenceStep: 0,
    campaignId: null,
    priority: 2,
    subject: "s",
    body: "b",
    snapshot: { name: "N", email: "n@x.io", greeting: "Bonjour," },
    threading: null,
    status: "pending",
    attempts: 0,
    lastError: null,
    messageId: null,
    cancelReason: null,
    createdAt: new Date(),
    sentAt: null,
    updatedAt: new Date(),
  };
}

describe("send-tick — archivage IMAP", () => {
  it("archive OK → imapArchived=true sur le log", async () => {
    queue = [entry()];
    const smtp = { send: vi.fn(async () => ({ messageId: "<m1>" })) };
    const imap = {
      ensureFolder: vi.fn(async () => undefined),
      append: vi.fn(async (_opts: { folder: string; raw: string; flags?: string[] }) => undefined),
      fetchNewMessages: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    const { runSendLoop } = await import("@/modules/mailing/services/send-tick");
    await runSendLoop({ smtp, twenty: null, imap, now: new Date() });

    expect(smtp.send).toHaveBeenCalledTimes(1);
    expect(imap.append).toHaveBeenCalledTimes(1);
    expect(imap.append.mock.calls[0]![0].folder).toBe("Posty");
    expect(archiveMarks).toEqual([{ logId: "log1", archived: true }]);
    expect(queue[0]!.status).toBe("sent");
  });

  it("APPEND throw → mail parti, imapArchived=false, PAS de renvoi SMTP, PAS de re-append", async () => {
    queue = [entry()];
    const smtp = { send: vi.fn(async () => ({ messageId: "<m1>" })) };
    const imap = {
      ensureFolder: vi.fn(async () => undefined),
      append: vi.fn(async () => {
        throw new Error("IMAP timeout");
      }),
      fetchNewMessages: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    const { notify } = await import("@/modules/shared/pushover/notify");
    const { runSendLoop } = await import("@/modules/mailing/services/send-tick");
    await runSendLoop({ smtp, twenty: null, imap, now: new Date() });

    // Le mail EST parti — une seule fois.
    expect(smtp.send).toHaveBeenCalledTimes(1);
    // Archivage tenté une fois puis abandonné.
    expect(imap.append).toHaveBeenCalledTimes(1);
    // Log marqué non archivé.
    expect(archiveMarks).toEqual([{ logId: "log1", archived: false }]);
    // Le status queue reste 'sent' — l'archivage ne le remet PAS en pending.
    expect(queue[0]!.status).toBe("sent");
    expect(queue[0]!.messageId).toBe("<m1>");
    // Notif priorité warn envoyée.
    expect(notify).toHaveBeenCalled();
  });

  it("dryRun=true → aucun APPEND tenté", async () => {
    // On force dryRun via un settings différent : override du mock.
    const settingsMod = await import("@/modules/mailing/repositories/mail-settings-repo");
    (settingsMod.getMailSettings as unknown as { mockResolvedValueOnce: (v: unknown) => void })
      .mockResolvedValueOnce({
        _id: "singleton",
        sendDays: [],
        dailyCap: 25,
        jitter: { minSeconds: 0, maxSeconds: 0 },
        sequence: { delays: [5, 9, 60], clientRelanceDays: 60 },
        smtp: { host: "smtp.local", port: 587, secure: false, user: "u", pass: "p", from: "me@local" },
        imap: { host: "imap.local", port: 993, user: "u", pass: "p", archiveFolder: "Posty", inboxFolder: "INBOX", spamFolder: "Spam" },
        twenty: { apiUrl: "" },
        greeting: { model: "x", temperature: 0, maxTokens: 100, systemPrompt: "" },
        bccLogs: null,
        paused: false,
        dryRun: true,
        updatedAt: new Date(),
      });
    queue = [entry()];
    const imap = {
      ensureFolder: vi.fn(async () => undefined),
      append: vi.fn(),
      fetchNewMessages: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    const { runSendLoop } = await import("@/modules/mailing/services/send-tick");
    // On passe l'imap explicitement pour bien vérifier qu'il n'est PAS
    // utilisé (l'archivage est skippé en dryRun même si un client est fourni).
    await runSendLoop({ twenty: null, imap, now: new Date() });
    expect(imap.append).not.toHaveBeenCalled();
    expect(archiveMarks).toHaveLength(0);
  });
});
