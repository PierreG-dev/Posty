import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { buildAfterSendPatch } from "@/modules/mailing/services/twenty-patch-after-send";

const baseSettings = {
  _id: "singleton" as const,
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
};

function co(overrides: any = {}) {
  return {
    id: "cA",
    name: "Acme",
    status: "PROSPECT" as const,
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

describe("buildAfterSendPatch", () => {
  it("step 0 → next = now + delays[1] = 9 j, toContact=false, PATCH exhaustif", () => {
    const sentAt = new Date("2026-07-16T12:00:00Z");
    const patch = buildAfterSendPatch({
      company: co({ followupCount: 0, messageReferences: null }),
      step: 0,
      messageId: "<a>",
      sentAt,
      settings: baseSettings,
    });
    expect(patch.followupCount).toBe(1);
    expect(patch.lastMessageId).toBe("<a>");
    expect(patch.toContact).toBe(false);
    expect(patch.messageReferences).toBe("<a>");
    const next = DateTime.fromISO(patch.nextFollowupAt!);
    expect(next.diff(DateTime.fromJSDate(sentAt), "days").days).toBeCloseTo(9, 0);
  });

  it("step 2 → PAS de nextFollowupAt (fin de séquence)", () => {
    const patch = buildAfterSendPatch({
      company: co({ followupCount: 2 }),
      step: 2,
      messageId: "<c>",
      sentAt: new Date(),
      settings: baseSettings,
    });
    expect(patch.followupCount).toBe(3);
    expect(patch.nextFollowupAt).toBeUndefined();
  });

  it("messageReferences existant est préservé et concaténé", () => {
    const patch = buildAfterSendPatch({
      company: co({ messageReferences: "<prev1> <prev2>" }),
      step: 1,
      messageId: "<new>",
      sentAt: new Date(),
      settings: baseSettings,
    });
    expect(patch.messageReferences).toBe("<prev1> <prev2> <new>");
  });
});
