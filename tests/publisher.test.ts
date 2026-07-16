import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";

// Env avant tout import de code applicatif.
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SESSION_SECRET = "x".repeat(48);
process.env.AUTH_PASSWORD_HASH = Buffer.from("stub", "utf8").toString("base64");
process.env.MONGODB_URI = "mongodb://localhost:27017";
process.env.MONGODB_DB = "posty_test";
process.env.LINKEDIN_API_VERSION = "202506";
process.env.APP_URL = "http://localhost:3000";

// ─── Fakes de repos ──────────────────────────────────────────────────────────
type PublicationsCall = Parameters<typeof import("@/modules/linkedin/repositories/publication-repo").createPublication>[0];

const fakePosts = new Map<string, unknown>();
const publicationsCalls: PublicationsCall[] = [];
const usedKeys = new Set<string>();
let claimReturnStatus = "queued";

function seedPost(id: string, overrides: Record<string, unknown> = {}) {
  fakePosts.set(id, {
    _id: id,
    content: "hello world",
    hashtags: ["#dev"],
    themeId: null,
    status: "queued",
    source: "manual",
    media: { kind: "none", assetId: null, altText: "", title: "" },
    firstComment: { text: null, status: "none" },
    queuePosition: 0,
    scheduledAt: null,
    publishedAt: null,
    linkedin: { urn: null, url: null },
    attempts: 0,
    lastError: null,
    aiMeta: null,
    sourceExternalId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

vi.mock("@/modules/linkedin/repositories/post-repo", () => ({
  getPost: vi.fn(async (id: string) => fakePosts.get(id) ?? null),
  claimForPublishing: vi.fn(async (id: string) => {
    const p = fakePosts.get(id) as Record<string, unknown> | undefined;
    if (!p) return null;
    if (!["queued", "scheduled", "draft", "failed"].includes(claimReturnStatus)) return null;
    const next = { ...p, status: "publishing" };
    fakePosts.set(id, next);
    return next;
  }),
  applyPublishOutcome: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    const p = fakePosts.get(id) as Record<string, unknown> | undefined;
    if (!p) return null;
    const next = { ...p, ...patch };
    if (patch.linkedin) next.linkedin = patch.linkedin;
    fakePosts.set(id, next);
    return next;
  }),
}));

vi.mock("@/modules/linkedin/repositories/publication-repo", () => ({
  createPublication: vi.fn(async (input: PublicationsCall) => {
    publicationsCalls.push(input);
    if (usedKeys.has(input.idempotencyKey)) {
      return { duplicate: true, existing: { idempotencyKey: input.idempotencyKey } };
    }
    usedKeys.add(input.idempotencyKey);
    return { duplicate: false, publication: { ...input, _id: "pub-" + publicationsCalls.length } };
  }),
}));

vi.mock("@/modules/linkedin/repositories/asset-repo", () => ({
  getAsset: vi.fn(async () => null),
  readAssetBinary: vi.fn(async () => Buffer.alloc(0)),
  cacheLinkedInUrn: vi.fn(async () => undefined),
}));

let dryRunFlag = false;
vi.mock("@/modules/shared/settings/repo", () => ({
  getSettings: vi.fn(async () => ({
    dryRun: dryRunFlag,
    pushover: { enabled: false, userKey: null, appToken: null },
  })),
  getLinkedInCredentials: vi.fn(async () => ({
    authorUrn: "urn:li:person:MOCK",
    accessToken: "TOKEN",
    refreshToken: "REFRESH",
    expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    refreshExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  })),
  saveLinkedInCredentials: vi.fn(async () => undefined),
  getLinkedInStatus: vi.fn(async () => ({ connected: true })),
}));

vi.mock("@/modules/shared/pushover/client", () => ({
  sendPushover: vi.fn(async () => true),
}));

// ─── Aides ──────────────────────────────────────────────────────────────────
async function loadPublisher() {
  return await import("@/modules/linkedin/services/publisher");
}
async function loadMock() {
  return await import("@/modules/linkedin/linkedin-api/mock-client");
}

beforeEach(async () => {
  fakePosts.clear();
  publicationsCalls.length = 0;
  usedKeys.clear();
  claimReturnStatus = "queued";
  dryRunFlag = false;
  vi.clearAllMocks();
  // Réinitialise l'implémentation de getSettings car certains tests utilisent mockResolvedValue.
  const settingsMod = await import("@/modules/shared/settings/repo");
  (settingsMod.getSettings as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
    dryRun: dryRunFlag,
    pushover: { enabled: false, userKey: null, appToken: null },
  }));
});

// ─── Tests ──────────────────────────────────────────────────────────────────
describe("publishPost — publication texte", () => {
  it("publie, met le post en `published` et enregistre publications.published", async () => {
    seedPost("p1");
    const { MockLinkedInClient } = await loadMock();
    const client = new MockLinkedInClient();
    const { publishPost } = await loadPublisher();
    const r = await publishPost("p1", { mode: "manual", client });
    expect(r.outcome).toBe("published");
    expect(client.published).toHaveLength(1);
    expect(client.published[0]!.kind).toBe("text");
    const post = fakePosts.get("p1") as Record<string, unknown>;
    expect(post.status).toBe("published");
    expect((post.linkedin as { urn: string }).urn).toContain("urn:li:share:");
    expect(publicationsCalls[0]!.outcome).toBe("published");
  });

  it("échappe `commentary` avant l'envoi (backslash sur `(`)", async () => {
    seedPost("p1", { content: "code: (abc)", hashtags: [] });
    const { MockLinkedInClient } = await loadMock();
    const client = new MockLinkedInClient();
    const { publishPost } = await loadPublisher();
    await publishPost("p1", { mode: "manual", client });
    const sent = client.published[0]! as { commentary: string };
    expect(sent.commentary).toContain("\\(");
    expect(sent.commentary).toContain("\\)");
  });
});

describe("publishPost — premier commentaire (repli spike)", () => {
  it("un post avec firstComment reste `published`, statut inchangé, notif Pushover envoyée", async () => {
    seedPost("p2", { firstComment: { text: "https://exemple.fr", status: "pending" } });
    const { sendPushover } = await import("@/modules/shared/pushover/client");
    const settingsMod = await import("@/modules/shared/settings/repo");
    (settingsMod.getSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      dryRun: false,
      pushover: { enabled: true, userKey: "u", appToken: "a" },
    });
    const { MockLinkedInClient } = await loadMock();
    const client = new MockLinkedInClient();
    const { publishPost } = await loadPublisher();
    const r = await publishPost("p2", { mode: "manual", client });
    expect(r.outcome).toBe("published");
    const post = fakePosts.get("p2") as Record<string, unknown>;
    expect(post.status).toBe("published");
    // firstComment.status n'est pas modifié — reste `pending` (repli spike).
    expect((post.firstComment as { status: string }).status).toBe("pending");
    // Notif Pushover envoyée.
    expect(sendPushover).toHaveBeenCalled();
  });
});

describe("publishPost — dryRun", () => {
  it("archive le payload, ne touche pas au post, aucun appel LinkedIn", async () => {
    dryRunFlag = true;
    seedPost("p3", { content: "hello (a)", hashtags: ["#foo"] });
    const { MockLinkedInClient } = await loadMock();
    const client = new MockLinkedInClient();
    const { publishPost } = await loadPublisher();
    const r = await publishPost("p3", { mode: "manual", client });
    expect(r.outcome).toBe("skipped_dry_run");
    expect(client.published).toHaveLength(0);
    const post = fakePosts.get("p3") as Record<string, unknown>;
    // Le post NE bascule PAS en publishing/published : dryRun laisse tout inchangé.
    expect(post.status).toBe("queued");
    // Une entrée publications avec outcome=skipped et payloadSnapshot rempli.
    expect(publicationsCalls).toHaveLength(1);
    expect(publicationsCalls[0]!.outcome).toBe("skipped");
    expect(publicationsCalls[0]!.payloadSnapshot).toBeTruthy();
    const payload = publicationsCalls[0]!.payloadSnapshot as { commentary: string };
    expect(payload.commentary).toContain("\\(");  // échappé même en dryRun
  });
});

describe("publishPost — 401 refresh + retry", () => {
  it("après un 401, refresh puis retry avec succès", async () => {
    seedPost("p4");
    const { MockLinkedInClient } = await loadMock();
    const client = new MockLinkedInClient({ onFirstCallUnauthorized: true });
    const { publishPost } = await loadPublisher();
    const r = await publishPost("p4", { mode: "manual", client });
    expect(r.outcome).toBe("published");
    expect(client.published).toHaveLength(1);
  });
});

describe("publishPost — idempotencyKey unique", () => {
  it("un appel avec un idempotencyKey déjà utilisé renvoie duplicate en dryRun", async () => {
    dryRunFlag = true;
    seedPost("p5");
    const { MockLinkedInClient } = await loadMock();
    const client = new MockLinkedInClient();
    const { publishPost } = await loadPublisher();
    const first = await publishPost("p5", { mode: "manual", client, idempotencyKey: "same-key" });
    expect(first.outcome).toBe("skipped_dry_run");
    const second = await publishPost("p5", { mode: "manual", client, idempotencyKey: "same-key" });
    expect(second.outcome).toBe("duplicate");
    expect(client.published).toHaveLength(0);
  });
});

describe("publishPost — échec API", () => {
  it("un 422 fait basculer le post en `failed`, écrit publications.api_failed", async () => {
    seedPost("p6");
    const { MockLinkedInClient } = await loadMock();
    const client = new MockLinkedInClient({ publishStatus: 422 });
    const { publishPost } = await loadPublisher();
    const r = await publishPost("p6", { mode: "manual", client });
    expect(r.outcome).toBe("failed");
    const post = fakePosts.get("p6") as Record<string, unknown>;
    expect(post.status).toBe("failed");
    expect(publicationsCalls.at(-1)!.outcome).toBe("api_failed");
  });
});
