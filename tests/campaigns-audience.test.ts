import { describe, it, expect } from "vitest";
import {
  computeCampaignAudience,
  type AudienceDecision,
} from "@/modules/mailing/services/campaigns-audience";
import type { TwentyCompany } from "@/modules/mailing/twenty/types";
import type { CompanyMeta } from "@/modules/mailing/domain/company-meta";

function company(overrides: Partial<TwentyCompany> = {}): TwentyCompany {
  return {
    id: overrides.id ?? "c1",
    name: overrides.name ?? "Org 1",
    // `?? "PROSPECT"` écraserait un status:null explicite ; on distingue.
    status: "status" in overrides ? overrides.status ?? null : "PROSPECT",
    isAutoHandled: overrides.isAutoHandled ?? true,
    toContact: overrides.toContact ?? false,
    followupCount: overrides.followupCount ?? 3,
    lastContactedAt: overrides.lastContactedAt ?? null,
    nextFollowupAt: overrides.nextFollowupAt ?? null,
    lastMessageId: overrides.lastMessageId ?? null,
    messageReferences: overrides.messageReferences ?? null,
    contactEmail: overrides.contactEmail ?? { primaryEmail: "a@b.co" },
  };
}

function meta(overrides: Partial<CompanyMeta> = {}): CompanyMeta {
  return {
    _id: "m1",
    companyId: overrides.companyId ?? "c1",
    greeting: overrides.greeting ?? "Bonjour,",
    greetingEditedByHuman: overrides.greetingEditedByHuman ?? false,
    paused: overrides.paused ?? false,
    pausedReason: overrides.pausedReason ?? null,
    pausedAt: overrides.pausedAt ?? null,
    bounce: overrides.bounce ?? null,
    updatedAt: overrides.updatedAt ?? new Date(),
  };
}

function first(list: AudienceDecision[]): AudienceDecision {
  const d = list[0];
  if (!d) throw new Error("aucune décision");
  return d;
}

describe("computeCampaignAudience — règles §6.4", () => {
  const already = new Set<string>();

  it("PARTENAIRE est toujours exclu", () => {
    const d = first(
      computeCampaignAudience({
        contacts: [{ company: company({ id: "p", status: "PARTENAIRE" }), meta: null }],
        alreadyRecipientIds: already,
      }),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("partenaire");
  });

  it("PROSPECT avec followupCount < 3 est exclu", () => {
    const d = first(
      computeCampaignAudience({
        contacts: [{ company: company({ status: "PROSPECT", followupCount: 2 }), meta: null }],
        alreadyRecipientIds: already,
      }),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("prospect_low_followup");
  });

  it("PROSPECT avec followupCount >= 3 est éligible", () => {
    const d = first(
      computeCampaignAudience({
        contacts: [{ company: company({ status: "PROSPECT", followupCount: 3 }), meta: null }],
        alreadyRecipientIds: already,
      }),
    );
    expect(d.eligible).toBe(true);
    expect(d.reason).toBeNull();
  });

  it("CLIENT est éligible sans condition de followup", () => {
    const d = first(
      computeCampaignAudience({
        contacts: [{ company: company({ status: "CLIENT", followupCount: 0 }), meta: null }],
        alreadyRecipientIds: already,
      }),
    );
    expect(d.eligible).toBe(true);
  });

  it("statut null ou hors {PROSPECT, CLIENT, PARTENAIRE} est rejeté", () => {
    const d = first(
      computeCampaignAudience({
        contacts: [{ company: company({ status: null }), meta: null }],
        alreadyRecipientIds: already,
      }),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("not_prospect_client");
  });

  it("paused → exclu", () => {
    const d = first(
      computeCampaignAudience({
        contacts: [{ company: company(), meta: meta({ paused: true }) }],
        alreadyRecipientIds: already,
      }),
    );
    expect(d.reason).toBe("paused");
  });

  it("hard bounce → exclu", () => {
    const d = first(
      computeCampaignAudience({
        contacts: [
          {
            company: company(),
            meta: meta({ bounce: { kind: "hard", count: 1, lastAt: new Date(), lastCode: "5.1.1" } }),
          },
        ],
        alreadyRecipientIds: already,
      }),
    );
    expect(d.reason).toBe("hard_bounce");
  });

  it("isAutoHandled=false reste ÉLIGIBLE en campagne, mais autoHandledOff=true", () => {
    const d = first(
      computeCampaignAudience({
        contacts: [{ company: company({ isAutoHandled: false }), meta: null }],
        alreadyRecipientIds: already,
      }),
    );
    expect(d.eligible).toBe(true);
    expect(d.reason).toBeNull();
    expect(d.autoHandledOff).toBe(true);
  });

  it("isAutoHandled=true → autoHandledOff=false (pas de drapeau)", () => {
    const d = first(
      computeCampaignAudience({
        contacts: [{ company: company({ isAutoHandled: true }), meta: null }],
        alreadyRecipientIds: already,
      }),
    );
    expect(d.autoHandledOff).toBe(false);
  });

  it("déjà destinataire de la campagne → exclu", () => {
    const d = first(
      computeCampaignAudience({
        contacts: [{ company: company({ id: "dup" }), meta: null }],
        alreadyRecipientIds: new Set(["dup"]),
      }),
    );
    expect(d.reason).toBe("already_received");
  });

  it("already_received prime même quand autoHandledOff", () => {
    const d = first(
      computeCampaignAudience({
        contacts: [{ company: company({ id: "x", isAutoHandled: false }), meta: null }],
        alreadyRecipientIds: new Set(["x"]),
      }),
    );
    expect(d.reason).toBe("already_received");
    expect(d.autoHandledOff).toBe(true);
  });
});
