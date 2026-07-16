import { describe, it, expect } from "vitest";
import { HttpTwentyClient } from "@/modules/mailing/twenty/client";

interface Call {
  url: string;
  init?: RequestInit;
}

function makeFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = async (input: string, init?: RequestInit) => {
    calls.push({ url: input, init });
    return handler({ url: input, init });
  };
  return { fetch: f as unknown as typeof fetch, calls };
}

describe("HttpTwentyClient", () => {
  it("envoie le token en header Authorization: Bearer — jamais en query", async () => {
    const { fetch: f, calls } = makeFetch(() =>
      new Response(JSON.stringify({ data: { companies: [] } }), { status: 200 }),
    );
    const c = new HttpTwentyClient({ baseUrl: "https://crm.example.com", token: "SECRET", fetchImpl: f });
    await c.listCompanies();
    const call = calls[0]!;
    const headers = call.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer SECRET");
    expect(call.url).not.toContain("token=");
    expect(call.url).not.toContain("SECRET");
  });

  it("rejette une baseUrl contenant token= (garde-fou §0)", () => {
    expect(() => new HttpTwentyClient({ baseUrl: "https://crm.example.com?token=xxx", token: "T" }))
      .toThrow(/token/i);
  });

  it("sérialise les filtres via ?filter=...", async () => {
    const { fetch: f, calls } = makeFetch(() =>
      new Response(JSON.stringify({ data: { companies: [] } }), { status: 200 }),
    );
    const c = new HttpTwentyClient({ baseUrl: "https://crm.example.com", token: "T", fetchImpl: f });
    await c.listCompanies({ isAutoHandled: true, status: "PROSPECT", toContact: true, limit: 5 });
    const url = calls[0]!.url;
    expect(url).toContain("filter=");
    expect(decodeURIComponent(url)).toContain("isAutoHandled[eq]:true");
    expect(decodeURIComponent(url)).toContain("status[eq]:PROSPECT");
    expect(decodeURIComponent(url)).toContain("toContact[eq]:true");
    expect(url).toContain("limit=5");
  });

  it("map correctement une company Twenty vers TwentyCompany", async () => {
    const raw = {
      id: "co_1",
      name: "École 42",
      status: "PROSPECT",
      isAutoHandled: true,
      toContact: false,
      followupCount: 2,
      lastContactedAt: "2026-01-01T10:00:00Z",
      nextFollowupAt: "2026-02-01T10:00:00Z",
      lastMessageId: "<msg@x>",
      messageReferences: "<a@x> <b@x>",
      contactEmail: { primaryEmail: "hello@42.fr" },
    };
    const { fetch: f } = makeFetch(() =>
      new Response(JSON.stringify({ data: { companies: [raw] } }), { status: 200 }),
    );
    const c = new HttpTwentyClient({ baseUrl: "https://crm.example.com", token: "T", fetchImpl: f });
    const { items } = await c.listCompanies();
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("École 42");
    expect(items[0]!.status).toBe("PROSPECT");
    expect(items[0]!.followupCount).toBe(2);
    expect(items[0]!.contactEmail?.primaryEmail).toBe("hello@42.fr");
  });

  it("PATCH envoie bien le body JSON et le header Authorization", async () => {
    const { fetch: f, calls } = makeFetch(() => new Response("", { status: 200 }));
    const c = new HttpTwentyClient({ baseUrl: "https://crm.example.com", token: "T", fetchImpl: f });
    await c.patchCompany("co_1", { toContact: false, followupCount: 3 });
    const call = calls[0]!;
    expect(call.init!.method).toBe("PATCH");
    const headers = call.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer T");
    expect(JSON.parse(String(call.init!.body))).toEqual({ toContact: false, followupCount: 3 });
    expect(call.url).toContain("/rest/companies/co_1");
  });

  it("mappe 401 → TwentyApiError", async () => {
    const { fetch: f } = makeFetch(() => new Response("nope", { status: 401 }));
    const c = new HttpTwentyClient({ baseUrl: "https://crm.example.com", token: "T", fetchImpl: f });
    await expect(c.listCompanies()).rejects.toMatchObject({ status: 401 });
  });

  it("getCompany renvoie null sur 404", async () => {
    const { fetch: f } = makeFetch(() => new Response("", { status: 404 }));
    const c = new HttpTwentyClient({ baseUrl: "https://crm.example.com", token: "T", fetchImpl: f });
    const r = await c.getCompany("nope");
    expect(r).toBeNull();
  });
});
