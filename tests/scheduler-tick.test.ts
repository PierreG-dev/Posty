import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { DateTime } from "luxon";

// Env applicatif AVANT tout import.
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SESSION_SECRET = "x".repeat(48);
process.env.AUTH_PASSWORD_HASH = Buffer.from("stub", "utf8").toString("base64");
process.env.MONGODB_URI = "mongodb://localhost:27017";
process.env.MONGODB_DB = "posty_test";
process.env.LINKEDIN_API_VERSION = "202506";
process.env.APP_URL = "http://localhost:3000";

// ─── State partagé pour les mocks ────────────────────────────────────────────
const publications: Array<Record<string, unknown>> = [];
const usedIdempotencyKeys = new Set<string>();
const publishCalls: Array<{ postId: string; opts: Record<string, unknown> }> = [];
let dryRunFlag = false;
let autoGenerationFlag = false;

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock("@/modules/linkedin/repositories/publication-repo", () => ({
  createPublication: vi.fn(async (input: Record<string, unknown>) => {
    const key = String(input.idempotencyKey);
    if (usedIdempotencyKeys.has(key)) {
      return { duplicate: true, existing: { idempotencyKey: key, ...input } };
    }
    usedIdempotencyKeys.add(key);
    publications.push(input);
    return { duplicate: false, publication: { _id: "pub" + publications.length, ...input } };
  }),
}));

vi.mock("@/modules/shared/settings/repo", () => ({
  getSettings: vi.fn(async () => ({
    dryRun: dryRunFlag,
    autoGeneration: autoGenerationFlag,
    minQueueAlert: 3,
    pushover: { enabled: false, userKey: null, appToken: null },
  })),
  getLinkedInStatus: vi.fn(async () => ({ connected: true })),
}));

vi.mock("@/modules/shared/pushover/notify", () => ({
  notify: vi.fn(async () => undefined),
}));

vi.mock("@/modules/linkedin/repositories/theme-repo", () => ({
  getTheme: vi.fn(async (id: string) => ({ _id: id, name: "Thème " + id })),
}));

// Le publisher est mocké : la tuyauterie réelle est déjà couverte par publisher.test.ts.
vi.mock("@/modules/linkedin/services/publisher", () => ({
  publishPost: vi.fn(async (postId: string, opts: Record<string, unknown>) => {
    publishCalls.push({ postId, opts });
    return { outcome: "published", postId, urn: "urn:li:share:X", url: "https://linkedin.com/x" };
  }),
}));

// Générateur mocké — piloté par test via `generatorBehavior`.
let generatorBehavior:
  | { kind: "ok"; postId: string }
  | { kind: "throw"; message: string }
  | { kind: "invalid" } = { kind: "ok", postId: "aiPost1" };
const generateCalls: Array<{ themeId: string; opts: Record<string, unknown> }> = [];
vi.mock("@/modules/linkedin/services/generator", () => ({
  generatePost: vi.fn(async (themeId: string, opts: Record<string, unknown>) => {
    generateCalls.push({ themeId, opts });
    if (generatorBehavior.kind === "throw") throw new Error(generatorBehavior.message);
    if (generatorBehavior.kind === "invalid") {
      return {
        themeId,
        model: "claude-sonnet-5",
        promptVersion: "v1-lot5",
        variants: [{ ok: false, errors: [{ path: "content", message: "trop long" }], warnings: [], rawResponse: "", attempts: 2 }],
        createdPosts: [],
      };
    }
    return {
      themeId,
      model: "claude-sonnet-5",
      promptVersion: "v1-lot5",
      variants: [{ ok: true, post: { content: "x", hashtags: [], firstComment: null, altText: "" }, warnings: [], rawResponse: "", attempts: 1 }],
      createdPosts: [{ _id: generatorBehavior.postId }],
    };
  }),
}));

// Repos slot & post — comportement pilotable par test.
let queueHead: { _id: string; content: string } | null = null;
vi.mock("@/modules/linkedin/repositories/slot-repo", () => ({
  listSlots: vi.fn(async () => currentSlots),
  getSlot: vi.fn(async (id: string) => currentSlots.find((s) => s._id === id) ?? null),
}));
vi.mock("@/modules/linkedin/repositories/post-repo", () => ({
  peekQueuedHead: vi.fn(async (_themeId: string | null) => queueHead),
  listScheduledDue: vi.fn(async () => currentOneShots),
  applyPublishOutcome: vi.fn(async () => null),
}));

// Verrou : renvoie toujours OK par défaut, mais on peut simuler la contention.
let lockHolders = new Map<string, string>();
vi.mock("@/modules/shared/locks/lock", () => ({
  withLock: vi.fn(async (key: string, _ttl: number, fn: () => Promise<unknown>) => {
    if (lockHolders.has(key)) return null;
    lockHolders.set(key, "me");
    try {
      return await fn();
    } finally {
      lockHolders.delete(key);
    }
  }),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────
type SlotFix = {
  _id: string;
  label: string;
  dayOfWeek: number;
  time: string;
  themeId: string;
  modeOverride: "queue" | "auto" | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

let currentSlots: SlotFix[] = [];
let currentOneShots: Array<Record<string, unknown>> = [];

function makeSlot(overrides: Partial<SlotFix> = {}): SlotFix {
  return {
    _id: "s1",
    label: "",
    dayOfWeek: 2,
    time: "09:00",
    themeId: "t1",
    modeOverride: null,
    active: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

// L'instant "mardi 09:00 heure de Paris".
function tuesday09Paris(): Date {
  return DateTime.fromObject(
    { year: 2026, month: 7, day: 14, hour: 9, minute: 0 },
    { zone: "Europe/Paris" },
  ).toJSDate();
}

beforeEach(() => {
  publications.length = 0;
  publishCalls.length = 0;
  generateCalls.length = 0;
  usedIdempotencyKeys.clear();
  lockHolders = new Map();
  dryRunFlag = false;
  autoGenerationFlag = false;
  queueHead = null;
  currentSlots = [];
  currentOneShots = [];
  generatorBehavior = { kind: "ok", postId: "aiPost1" };
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────
describe("resolvePublication — mode queue", () => {
  it("file vide → outcome=empty_queue, Pushover envoyé, publishPost PAS appelé", async () => {
    currentSlots = [makeSlot()];
    queueHead = null;
    const { runSchedulerTick } = await import("@/modules/linkedin/services/scheduler-tick");
    const { notify } = await import("@/modules/shared/pushover/notify");

    await runSchedulerTick(tuesday09Paris());

    expect(publications).toHaveLength(1);
    expect(publications[0]!.outcome).toBe("empty_queue");
    expect(publishCalls).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("file non vide → publishPost appelé avec la bonne idempotencyKey", async () => {
    currentSlots = [makeSlot({ _id: "slotA" })];
    queueHead = { _id: "postX", content: "hello" };
    const { runSchedulerTick } = await import("@/modules/linkedin/services/scheduler-tick");

    await runSchedulerTick(tuesday09Paris());

    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]!.postId).toBe("postX");
    expect(publishCalls[0]!.opts.mode).toBe("queue");
    expect(publishCalls[0]!.opts.idempotencyKey).toBe("slotA-2026-07-14-09:00");
  });
});

describe("resolvePublication — modeOverride écrase autoGeneration global", () => {
  it("modeOverride='queue' même si autoGeneration=true → consomme la file", async () => {
    autoGenerationFlag = true;
    currentSlots = [makeSlot({ modeOverride: "queue" })];
    queueHead = { _id: "postY", content: "z" };
    const { runSchedulerTick } = await import("@/modules/linkedin/services/scheduler-tick");
    await runSchedulerTick(tuesday09Paris());
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]!.postId).toBe("postY");
  });
});

describe("resolvePublication — mode auto (lot 5)", () => {
  it("génération OK → publishPost appelé sur le post généré, file INTACTE, pas de Pushover d'erreur", async () => {
    autoGenerationFlag = true;
    currentSlots = [makeSlot({ _id: "sAuto1" })];
    queueHead = { _id: "shouldNotFire", content: "reserved" };
    generatorBehavior = { kind: "ok", postId: "aiPostA" };
    const { runSchedulerTick } = await import("@/modules/linkedin/services/scheduler-tick");
    const { notify } = await import("@/modules/shared/pushover/notify");
    const { peekQueuedHead } = await import("@/modules/linkedin/repositories/post-repo");

    await runSchedulerTick(tuesday09Paris());

    // Générateur appelé une fois, publishPost sur le post IA, mode='auto',
    // idempotencyKey stable.
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]!.themeId).toBe("t1");
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]!.postId).toBe("aiPostA");
    expect(publishCalls[0]!.opts.mode).toBe("auto");
    // File JAMAIS consommée en mode auto.
    expect(peekQueuedHead).not.toHaveBeenCalled();
    // Aucune notif d'erreur.
    expect(notify).not.toHaveBeenCalled();
  });

  it("génération throw → publications.generation_failed, Pushover, PAS de publish, file intacte", async () => {
    autoGenerationFlag = true;
    currentSlots = [makeSlot({ _id: "sAuto2" })];
    generatorBehavior = { kind: "throw", message: "ANTHROPIC_API_KEY manquant" };
    const { runSchedulerTick } = await import("@/modules/linkedin/services/scheduler-tick");
    const { notify } = await import("@/modules/shared/pushover/notify");
    const { peekQueuedHead } = await import("@/modules/linkedin/repositories/post-repo");

    await runSchedulerTick(tuesday09Paris());

    expect(publications).toHaveLength(1);
    expect(publications[0]!.outcome).toBe("generation_failed");
    expect(publishCalls).toHaveLength(0);
    expect(peekQueuedHead).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("génération produit un JSON invalide → publications.validation_failed, Pushover, file intacte", async () => {
    autoGenerationFlag = true;
    currentSlots = [makeSlot({ _id: "sAuto3" })];
    generatorBehavior = { kind: "invalid" };
    const { runSchedulerTick } = await import("@/modules/linkedin/services/scheduler-tick");
    const { notify } = await import("@/modules/shared/pushover/notify");

    await runSchedulerTick(tuesday09Paris());

    expect(publications).toHaveLength(1);
    expect(publications[0]!.outcome).toBe("validation_failed");
    expect(publishCalls).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("idempotence — deux ticks simultanés sur le même slot/jour", () => {
  it("deux appels concurrents ne produisent qu'UNE seule publication", async () => {
    currentSlots = [makeSlot({ _id: "slotDup" })];
    queueHead = { _id: "postDup", content: "z" };
    const { runSchedulerTick } = await import("@/modules/linkedin/services/scheduler-tick");

    // Deux ticks lancés en parallèle (simule deux workers).
    await Promise.all([
      runSchedulerTick(tuesday09Paris()),
      runSchedulerTick(tuesday09Paris()),
    ]);

    // Un seul publishPost appelé — l'autre a été bloqué par le verrou.
    expect(publishCalls.length).toBeLessThanOrEqual(1);
  });

  it("un second appel après relâche du verrou est bloqué par l'index unique publications (mode auto en échec)", async () => {
    currentSlots = [makeSlot({ _id: "slotIdx" })];
    autoGenerationFlag = true;
    // On force un échec de génération : le succès ne passe pas par createPublication
    // dans le mock (c'est publishPost qui le ferait, et il est mocké).
    generatorBehavior = { kind: "throw", message: "boom" };
    const { runSchedulerTick } = await import("@/modules/linkedin/services/scheduler-tick");

    await runSchedulerTick(tuesday09Paris());
    await runSchedulerTick(tuesday09Paris());

    // 2 appels, 1 seule entrée effectivement créée (l'autre = duplicate).
    expect(publications).toHaveLength(1);
    expect(publications[0]!.outcome).toBe("generation_failed");
  });
});

describe("one-shot manqué", () => {
  it("un one-shot manqué de 3 h → publications.skipped, applyPublishOutcome(failed), notify", async () => {
    const missed = new Date(Date.now() - 3 * 3600_000);
    currentOneShots = [
      {
        _id: "pMiss",
        status: "scheduled",
        scheduledAt: missed,
        content: "x",
        hashtags: [],
        themeId: null,
        source: "manual",
        media: { kind: "none", assetId: null, altText: "", title: "" },
        firstComment: { text: null, status: "none" },
        queuePosition: 0,
        publishedAt: null,
        linkedin: { urn: null, url: null },
        attempts: 0,
        lastError: null,
        aiMeta: null,
        sourceExternalId: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ];
    const { runSchedulerTick } = await import("@/modules/linkedin/services/scheduler-tick");
    const { notify } = await import("@/modules/shared/pushover/notify");
    const { applyPublishOutcome } = await import("@/modules/linkedin/repositories/post-repo");

    const r = await runSchedulerTick(new Date());

    expect(r.missed).toBe(1);
    expect(publications[0]!.outcome).toBe("skipped");
    expect(publications[0]!.error).toContain("manqué");
    expect(publishCalls).toHaveLength(0);
    expect(applyPublishOutcome).toHaveBeenCalledWith(
      "pMiss",
      expect.objectContaining({ status: "failed" }),
    );
    expect(notify).toHaveBeenCalled();
  });

  it("un one-shot dans la fenêtre appelle publishPost", async () => {
    const recent = new Date(Date.now() - 2 * 60_000);
    currentOneShots = [
      {
        _id: "pOk",
        status: "scheduled",
        scheduledAt: recent,
        content: "x",
        hashtags: [],
        themeId: null,
        source: "manual",
        media: { kind: "none", assetId: null, altText: "", title: "" },
        firstComment: { text: null, status: "none" },
        queuePosition: 0,
        publishedAt: null,
        linkedin: { urn: null, url: null },
        attempts: 0,
        lastError: null,
        aiMeta: null,
        sourceExternalId: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ];
    const { runSchedulerTick } = await import("@/modules/linkedin/services/scheduler-tick");
    await runSchedulerTick(new Date());
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]!.postId).toBe("pOk");
    expect(publishCalls[0]!.opts.idempotencyKey).toBe("oneshot-pOk");
  });
});
