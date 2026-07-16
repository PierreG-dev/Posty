import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import type { TwentyClient, TwentyCompany } from "@/modules/mailing/twenty/types";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SESSION_SECRET = "x".repeat(48);
process.env.AUTH_PASSWORD_HASH = Buffer.from("stub", "utf8").toString("base64");
process.env.MONGODB_URI = "mongodb://localhost:27017";
process.env.MONGODB_DB = "posty_test";

// État partagé pour les mocks
interface Inserted {
  companyId: string;
  kind: "sequence" | "campaign";
  sequenceStep: number | null;
  campaignId: string | null;
  subject: string;
  body: string;
  snapshot: { name: string; email: string; greeting: string };
  threading: { inReplyTo: string | null; references: string | null } | null;
  priority: 1 | 2 | 3;
}

let inserted: Inserted[] = [];
let seenKeys = new Set<string>();

const CAMPAIGN_ID = "camp-abc";

let currentCampaign: {
  _id: string;
  name: string;
  subject: string;
  body: string;
  blockIds: string[];
  targetCompanyIds: string[];
  status: "draft" | "queued";
  stats: { total: number; enqueued: number; sent: number; failed: number; cancelled: number };
  createdAt: Date;
  updatedAt: Date;
  queuedAt: Date | null;
  completedAt: Date | null;
};

let alreadyIds = new Set<string>();

vi.mock("@/modules/mailing/repositories/mail-queue-repo", () => ({
  enqueue: vi.fn(async (input: Inserted) => {
    const key =
      input.kind === "campaign"
        ? `camp:${input.companyId}:${input.campaignId}`
        : `seq:${input.companyId}:${input.sequenceStep}`;
    if (seenKeys.has(key)) return { duplicate: true };
    seenKeys.add(key);
    inserted.push(input);
    return { duplicate: false, entry: { _id: `id-${inserted.length}`, ...input } };
  }),
}));

vi.mock("@/modules/mailing/repositories/mail-blocks-repo", () => ({
  listBlocksByIds: vi.fn(async (ids: string[]) =>
    ids.map((id) => ({
      _id: id,
      name: id,
      kind: "custom",
      content: `[${id}]`,
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  ),
}));

vi.mock("@/modules/mailing/repositories/company-meta-repo", () => ({
  listMetaByIds: vi.fn(async () => new Map()),
  getMeta: vi.fn(async () => null),
  setGeneratedGreeting: vi.fn(async () => ({})),
}));

vi.mock("@/modules/mailing/repositories/campaigns-repo", () => ({
  getCampaign: vi.fn(async () => currentCampaign),
  findCampaignRecipientIds: vi.fn(async () => alreadyIds),
  setCampaignStatus: vi.fn(async () => currentCampaign),
  refreshCampaignStats: vi.fn(async () => currentCampaign.stats),
}));

vi.mock("@/modules/mailing/services/greeting", () => ({
  GREETING_FALLBACK: "Bonjour,",
  getOrCreateGreeting: vi.fn(async (_id: string, name: string) => `Bonjour l'équipe de ${name},`),
}));

function makeCompany(id: string, over: Partial<TwentyCompany> = {}): TwentyCompany {
  return {
    id,
    name: `Org ${id}`,
    status: "PROSPECT",
    isAutoHandled: true,
    toContact: false,
    followupCount: 3,
    lastContactedAt: null,
    nextFollowupAt: null,
    lastMessageId: "msg-old@x",
    messageReferences: "<ref@x>",
    contactEmail: { primaryEmail: `${id}@x.co` },
    ...over,
  };
}

function makeTwenty(companies: Map<string, TwentyCompany>): TwentyClient {
  return {
    listCompanies: async () => ({ items: [...companies.values()], nextCursor: null }),
    getCompany: async (id) => companies.get(id) ?? null,
    patchCompany: async () => {},
    ping: async () => ({ ok: true }),
  };
}

beforeEach(() => {
  inserted = [];
  seenKeys = new Set();
  alreadyIds = new Set();
  currentCampaign = {
    _id: CAMPAIGN_ID,
    name: "Test",
    subject: "Sujet neuf",
    body: "Corps de la campagne.",
    blockIds: ["b-sig"],
    targetCompanyIds: [],
    status: "draft",
    stats: { total: 0, enqueued: 0, sent: 0, failed: 0, cancelled: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
    queuedAt: null,
    completedAt: null,
  };
  vi.clearAllMocks();
});

describe("enqueueCampaign — anti-doublon & threading", () => {
  it("threading est TOUJOURS null pour une entrée de campagne (§6.5)", async () => {
    currentCampaign.targetCompanyIds = ["c1"];
    const t = makeTwenty(new Map([["c1", makeCompany("c1")]]));
    const { enqueueCampaign } = await import("@/modules/mailing/services/campaigns-enqueue");
    const r = await enqueueCampaign(CAMPAIGN_ID, { twenty: t });
    expect(r.ok).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.threading).toBeNull();
    expect(inserted[0]!.kind).toBe("campaign");
    expect(inserted[0]!.priority).toBe(3);
  });

  it("un contact déjà présent dans alreadyIds n'est pas enfilé (garde-fou serveur)", async () => {
    currentCampaign.targetCompanyIds = ["c1", "c2"];
    alreadyIds = new Set(["c1"]);
    const t = makeTwenty(
      new Map([
        ["c1", makeCompany("c1")],
        ["c2", makeCompany("c2")],
      ]),
    );
    const { enqueueCampaign } = await import("@/modules/mailing/services/campaigns-enqueue");
    const r = await enqueueCampaign(CAMPAIGN_ID, { twenty: t });
    expect(r.ok).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.companyId).toBe("c2");
  });

  it("une cible PARTENAIRE dans targetCompanyIds est REJETÉE même si le client la force", async () => {
    // Simulation du cas « id forcé côté client qui ne devrait pas passer ».
    currentCampaign.targetCompanyIds = ["p1"];
    const t = makeTwenty(new Map([["p1", makeCompany("p1", { status: "PARTENAIRE" })]]));
    const { enqueueCampaign } = await import("@/modules/mailing/services/campaigns-enqueue");
    const r = await enqueueCampaign(CAMPAIGN_ID, { twenty: t });
    expect(r.ok).toBe(true);
    expect(inserted).toHaveLength(0);
  });

  it("l'index unique { companyId, campaignId } empêche un doublon même sur rappel", async () => {
    currentCampaign.targetCompanyIds = ["c1"];
    const t = makeTwenty(new Map([["c1", makeCompany("c1")]]));
    const { enqueueCampaign } = await import("@/modules/mailing/services/campaigns-enqueue");
    await enqueueCampaign(CAMPAIGN_ID, { twenty: t });
    // Rappel : la campagne n'est plus draft, refus explicite ; ce test
    // couvre le cas où on remettrait draft et rappellerait.
    currentCampaign.status = "draft";
    const r2 = await enqueueCampaign(CAMPAIGN_ID, { twenty: t });
    expect(r2.ok).toBe(true);
    // L'index unique a bloqué le second insert : seule la 1re entrée existe.
    expect(inserted).toHaveLength(1);
  });

  it("refuse si status !== draft", async () => {
    currentCampaign.status = "queued";
    currentCampaign.targetCompanyIds = ["c1"];
    const t = makeTwenty(new Map([["c1", makeCompany("c1")]]));
    const { enqueueCampaign } = await import("@/modules/mailing/services/campaigns-enqueue");
    const r = await enqueueCampaign(CAMPAIGN_ID, { twenty: t });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_draft");
  });
});

describe("renderCampaignBody — composition", () => {
  it("salutation en tête, corps identique, blocs concaténés dans l'ordre", async () => {
    const { renderCampaignBody } = await import("@/modules/mailing/services/campaigns-render");
    const out = renderCampaignBody({
      greeting: "Bonjour l'équipe de X,",
      body: "Corps.",
      blocks: [
        { _id: "a", name: "a", kind: "custom", content: "SIG", isDefault: false, createdAt: new Date(), updatedAt: new Date() },
        { _id: "b", name: "b", kind: "custom", content: "FOOTER", isDefault: false, createdAt: new Date(), updatedAt: new Date() },
      ],
    });
    expect(out).toBe("Bonjour l'équipe de X,\n\nCorps.\n\nSIG\n\nFOOTER");
  });
});
