import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.SESSION_SECRET = "x".repeat(48);
  process.env.AUTH_PASSWORD_HASH = Buffer.from("stub", "utf8").toString("base64");
  process.env.MONGODB_URI = "mongodb://localhost:27017";
  process.env.MONGODB_DB = "posty_test";
  process.env.LINKEDIN_API_VERSION = "202506";
});

interface FakeCall {
  url: string;
  init?: RequestInit;
}

function makeFetch(handler: (call: FakeCall) => Response | Promise<Response>) {
  const calls: FakeCall[] = [];
  const f = async (input: string, init?: RequestInit) => {
    const call = { url: input, init };
    calls.push(call);
    return handler(call);
  };
  return { fetch: f as unknown as typeof fetch, calls };
}

describe("PostsApiClient", () => {
  it("publie du texte, parse x-restli-id (urn:li:share)", async () => {
    const { PostsApiClient } = await import("@/modules/linkedin/linkedin-api");
    const { fetch: f, calls } = makeFetch(() =>
      new Response("{}", { status: 201, headers: { "x-restli-id": "urn:li:share:123" } }),
    );
    const c = new PostsApiClient({ fetchImpl: f });
    const r = await c.publish("TOKEN", { kind: "text", author: "urn:li:person:X", commentary: "hello" });
    expect(r.urn).toBe("urn:li:share:123");
    expect(r.url).toContain("urn%3Ali%3Ashare%3A123");
    expect(r.status).toBe(201);
    // Vérifie que les headers requis sont envoyés.
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer TOKEN");
    expect(headers["LinkedIn-Version"]).toBe("202506");
    expect(headers["X-Restli-Protocol-Version"]).toBe("2.0.0");
  });

  it("accepte urn:li:ugcPost (documents) — spike test 4", async () => {
    const { PostsApiClient } = await import("@/modules/linkedin/linkedin-api");
    const { fetch: f } = makeFetch(() =>
      new Response("{}", { status: 201, headers: { "x-restli-id": "urn:li:ugcPost:999" } }),
    );
    const c = new PostsApiClient({ fetchImpl: f });
    const r = await c.publish("T", {
      kind: "document",
      author: "urn:li:person:X",
      commentary: "x",
      documentUrn: "urn:li:document:1",
      title: "titre",
    });
    expect(r.urn).toBe("urn:li:ugcPost:999");
  });

  it("mappe 401 → unauthorized", async () => {
    const { PostsApiClient, LinkedInApiError } = await import("@/modules/linkedin/linkedin-api");
    const { fetch: f } = makeFetch(() => new Response("expired", { status: 401 }));
    const c = new PostsApiClient({ fetchImpl: f });
    await expect(
      c.publish("T", { kind: "text", author: "urn:li:person:X", commentary: "x" }),
    ).rejects.toBeInstanceOf(LinkedInApiError);
    try {
      await c.publish("T", { kind: "text", author: "urn:li:person:X", commentary: "x" });
    } catch (err) {
      expect((err as InstanceType<typeof LinkedInApiError>).kind).toBe("unauthorized");
    }
  });

  it("mappe 422 → validation avec responseSnippet tronqué", async () => {
    const { PostsApiClient, LinkedInApiError } = await import("@/modules/linkedin/linkedin-api");
    const body = JSON.stringify({ serviceErrorCode: 100, message: "bad" });
    const { fetch: f } = makeFetch(() => new Response(body, { status: 422 }));
    const c = new PostsApiClient({ fetchImpl: f });
    try {
      await c.publish("T", { kind: "text", author: "urn:li:person:X", commentary: "x" });
      throw new Error("did not throw");
    } catch (err) {
      const e = err as InstanceType<typeof LinkedInApiError>;
      expect(e.kind).toBe("validation");
      expect(e.serviceErrorCode).toBe(100);
      expect(e.responseSnippet).toContain("serviceErrorCode");
    }
  });

  it("mappe 429 → rate_limited", async () => {
    const { PostsApiClient, LinkedInApiError } = await import("@/modules/linkedin/linkedin-api");
    const { fetch: f } = makeFetch(() => new Response("slow", { status: 429 }));
    const c = new PostsApiClient({ fetchImpl: f });
    try {
      await c.publish("T", { kind: "text", author: "urn:li:person:X", commentary: "x" });
      throw new Error("did not throw");
    } catch (err) {
      expect((err as InstanceType<typeof LinkedInApiError>).kind).toBe("rate_limited");
    }
  });

  it("échoue proprement si x-restli-id absent (server)", async () => {
    const { PostsApiClient, LinkedInApiError } = await import("@/modules/linkedin/linkedin-api");
    const { fetch: f } = makeFetch(() => new Response("{}", { status: 201 }));
    const c = new PostsApiClient({ fetchImpl: f });
    try {
      await c.publish("T", { kind: "text", author: "urn:li:person:X", commentary: "x" });
      throw new Error("did not throw");
    } catch (err) {
      expect((err as InstanceType<typeof LinkedInApiError>).kind).toBe("server");
    }
  });
});
