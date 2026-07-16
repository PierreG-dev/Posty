import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";

// Env applicatif AVANT tout import (patron des autres tests).
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SESSION_SECRET = "x".repeat(48);
process.env.AUTH_PASSWORD_HASH = Buffer.from("stub", "utf8").toString("base64");
process.env.MONGODB_URI = "mongodb://localhost:27017";
process.env.MONGODB_DB = "posty_test";
process.env.APP_URL = "http://localhost:3000";

// ─── État partagé des mocks ─────────────────────────────────────────────────

interface Creds {
  authorUrn: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  refreshExpiresAt: Date;
}

let credsState: Creds | null = null;
let savedCreds: Creds[] = [];
let pushoverCalls: Array<{ title: string; message: string; priority?: number }> = [];
let settingsState: {
  pushover: { enabled: boolean; userKey: string | null; appToken: string | null };
} = {
  pushover: { enabled: true, userKey: "USER", appToken: "APP" },
};

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/modules/shared/settings/repo", () => ({
  getSettings: vi.fn(async () => settingsState),
  getLinkedInCredentials: vi.fn(async () => credsState),
  saveLinkedInCredentials: vi.fn(async (c: Creds) => {
    savedCreds.push(c);
    credsState = c;
  }),
}));

vi.mock("@/modules/shared/pushover/client", () => ({
  sendPushover: vi.fn(async (_creds: unknown, msg: { title: string; message: string; priority?: number }) => {
    pushoverCalls.push({ title: msg.title, message: msg.message, priority: msg.priority });
    return true;
  }),
}));

// ─── Client LinkedIn factice ────────────────────────────────────────────────

function makeClient(overrides: Partial<{
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  refreshExpiresInSec: number;
}> = {}) {
  const refreshAccessToken = vi.fn(async () => ({
    accessToken: overrides.accessToken ?? "NEW_ACCESS",
    refreshToken: overrides.refreshToken ?? "NEW_REFRESH",
    expiresInSec: overrides.expiresInSec ?? 60 * 24 * 3600, // 60 j
    refreshExpiresInSec: overrides.refreshExpiresInSec ?? 365 * 24 * 3600, // 365 j
  }));
  return { refreshAccessToken } as unknown as import("@/modules/linkedin/linkedin-api").LinkedInClient & {
    refreshAccessToken: typeof refreshAccessToken;
  };
}

const DAY_MS = 24 * 3600 * 1000;

beforeEach(() => {
  savedCreds = [];
  pushoverCalls = [];
  settingsState = { pushover: { enabled: true, userKey: "USER", appToken: "APP" } };
  credsState = null;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("refreshIfNeeded — §10.3 CDC-01", () => {
  it("non connecté → not_connected, ne touche à rien", async () => {
    credsState = null;
    const { refreshIfNeeded } = await import("@/modules/linkedin/services/token-refresh");
    const client = makeClient();
    const r = await refreshIfNeeded(client);
    expect(r.status).toBe("not_connected");
    expect(client.refreshAccessToken).not.toHaveBeenCalled();
    expect(savedCreds).toHaveLength(0);
    expect(pushoverCalls).toHaveLength(0);
  });

  it("access token expire dans > 7 j → still_valid, PAS de refresh", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    credsState = {
      authorUrn: "urn:li:person:X",
      accessToken: "OLD",
      refreshToken: "OLD_R",
      expiresAt: new Date(now.getTime() + 30 * DAY_MS), // 30 j de marge
      refreshExpiresAt: new Date(now.getTime() + 300 * DAY_MS),
    };
    const { refreshIfNeeded } = await import("@/modules/linkedin/services/token-refresh");
    const client = makeClient();
    const r = await refreshIfNeeded(client, now);
    expect(r.status).toBe("still_valid");
    expect(client.refreshAccessToken).not.toHaveBeenCalled();
    expect(savedCreds).toHaveLength(0);
  });

  it("access token expire dans < 7 j → refreshed, nouveaux tokens sauvés", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    credsState = {
      authorUrn: "urn:li:person:X",
      accessToken: "OLD",
      refreshToken: "OLD_R",
      expiresAt: new Date(now.getTime() + 3 * DAY_MS), // 3 j = < 7
      refreshExpiresAt: new Date(now.getTime() + 300 * DAY_MS),
    };
    const { refreshIfNeeded } = await import("@/modules/linkedin/services/token-refresh");
    const client = makeClient();
    const r = await refreshIfNeeded(client, now);
    expect(r.status).toBe("refreshed");
    expect(client.refreshAccessToken).toHaveBeenCalledWith("OLD_R");
    expect(savedCreds).toHaveLength(1);
    expect(savedCreds[0]!.accessToken).toBe("NEW_ACCESS");
    expect(savedCreds[0]!.refreshToken).toBe("NEW_REFRESH");
    // La date d'expiration est calculée à partir de `now` + expiresInSec.
    const expectedExpires = new Date(now.getTime() + 60 * DAY_MS).getTime();
    expect(savedCreds[0]!.expiresAt.getTime()).toBe(expectedExpires);
  });

  it("refresh token expire dans < 14 j → Pushover envoyé", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    credsState = {
      authorUrn: "urn:li:person:X",
      accessToken: "OLD",
      refreshToken: "OLD_R",
      expiresAt: new Date(now.getTime() + 30 * DAY_MS), // access encore valide
      refreshExpiresAt: new Date(now.getTime() + 10 * DAY_MS), // 10 j = < 14
    };
    const { refreshIfNeeded } = await import("@/modules/linkedin/services/token-refresh");
    const client = makeClient();
    await refreshIfNeeded(client, now);
    expect(pushoverCalls).toHaveLength(1);
    expect(pushoverCalls[0]!.message).toMatch(/Reconnexion LinkedIn requise/);
    expect(pushoverCalls[0]!.priority).toBe(1);
  });

  it("refresh token EXPIRÉ → reconnect_required, PAS de tentative de refresh", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    credsState = {
      authorUrn: "urn:li:person:X",
      accessToken: "OLD",
      refreshToken: "OLD_R",
      expiresAt: new Date(now.getTime() - 1 * DAY_MS),
      refreshExpiresAt: new Date(now.getTime() - 1 * DAY_MS), // déjà expiré
    };
    const { refreshIfNeeded } = await import("@/modules/linkedin/services/token-refresh");
    const client = makeClient();
    const r = await refreshIfNeeded(client, now);
    expect(r.status).toBe("reconnect_required");
    expect(r.credentials).toBeNull();
    expect(client.refreshAccessToken).not.toHaveBeenCalled();
    expect(pushoverCalls).toHaveLength(1); // Pushover envoyé quand même
  });

  it("Pushover désactivé → pas de notification même si refresh proche", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    settingsState.pushover.enabled = false;
    credsState = {
      authorUrn: "urn:li:person:X",
      accessToken: "OLD",
      refreshToken: "OLD_R",
      expiresAt: new Date(now.getTime() + 30 * DAY_MS),
      refreshExpiresAt: new Date(now.getTime() + 10 * DAY_MS),
    };
    const { refreshIfNeeded } = await import("@/modules/linkedin/services/token-refresh");
    const client = makeClient();
    await refreshIfNeeded(client, now);
    expect(pushoverCalls).toHaveLength(0);
  });
});

describe("forceRefresh — appelé sur 401 en cours de publication", () => {
  it("écrase les tokens et renvoie les nouveaux", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const oldCreds: Creds = {
      authorUrn: "urn:li:person:X",
      accessToken: "OLD",
      refreshToken: "OLD_R",
      expiresAt: new Date(now.getTime() + 1 * DAY_MS),
      refreshExpiresAt: new Date(now.getTime() + 100 * DAY_MS),
    };
    const { forceRefresh } = await import("@/modules/linkedin/services/token-refresh");
    const client = makeClient({ accessToken: "FORCED", refreshToken: "FORCED_R" });
    const next = await forceRefresh(client, oldCreds, now);
    expect(next.accessToken).toBe("FORCED");
    expect(next.refreshToken).toBe("FORCED_R");
    expect(next.authorUrn).toBe(oldCreds.authorUrn); // URN préservé
    expect(client.refreshAccessToken).toHaveBeenCalledWith("OLD_R");
    expect(savedCreds).toHaveLength(1);
  });
});
