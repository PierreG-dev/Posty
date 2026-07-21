import { logger } from "@/modules/shared/logger";
import { twentyFromEnv } from "@/modules/mailing/twenty";
import type { TwentyClient, TwentyCompany } from "@/modules/mailing/twenty/types";
import { listBlocksByIds } from "@/modules/mailing/repositories/mail-blocks-repo";
import { listMetaByIds } from "@/modules/mailing/repositories/company-meta-repo";
import {
  enqueue as enqueueRow,
  type EnqueueResult,
} from "@/modules/mailing/repositories/mail-queue-repo";
import {
  findCampaignRecipientIds,
  getCampaign,
  refreshCampaignStats,
  setCampaignEnqueueReport,
  setCampaignStatus,
} from "@/modules/mailing/repositories/campaigns-repo";
import type { Campaign } from "@/modules/mailing/domain/campaigns";
import { getOrCreateGreeting, GREETING_FALLBACK } from "./greeting";
import { computeCampaignAudience } from "./campaigns-audience";
import type { ExclusionReason } from "@/modules/mailing/domain/campaigns";
import { renderCampaignBody } from "./campaigns-render";
import type { AnthropicClient } from "@/modules/shared/anthropic/client";

// CDC-02 §6.4 — met en file les N entrées d'une campagne.
//
// Étapes :
//   1. Recharge la campagne, exige status='draft'.
//   2. Recharge les cibles depuis Twenty (garde-fou serveur : on ne fait pas
//      confiance à targetCompanyIds, on RÉ-APPLIQUE l'éligibilité — un id
//      forcé côté client qui ne devrait pas passer ne passera pas).
//   3. Pour chaque contact éligible : greeting figé, rendu figé, enqueue.
//   4. Duplicate silencieux (index unique { companyId, campaignId }).
//   5. status='queued', stats.total renseignées.

export interface EnqueueCampaignOpts {
  twenty?: TwentyClient | null;
  anthropicClient?: AnthropicClient;
}

export interface EnqueueCampaignResult {
  ok: true;
  campaignId: string;
  candidates: number;
  enqueued: number;
  duplicates: number;
  skipped: {
    noEmail: number;
    notFound: number;
    excluded: number;
    excludedByReason: Partial<Record<ExclusionReason, number>>;
    errors: number;
  };
}

export type EnqueueCampaignError =
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_draft"; currentStatus: string }
  | { ok: false; reason: "no_targets" }
  | { ok: false; reason: "no_twenty" };

export async function enqueueCampaign(
  campaignId: string,
  opts: EnqueueCampaignOpts = {},
): Promise<EnqueueCampaignResult | EnqueueCampaignError> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) return { ok: false, reason: "not_found" };
  if (campaign.status !== "draft") {
    return { ok: false, reason: "not_draft", currentStatus: campaign.status };
  }
  if (campaign.targetCompanyIds.length === 0) {
    return { ok: false, reason: "no_targets" };
  }

  const twenty = opts.twenty === null ? null : (opts.twenty ?? twentyFromEnv());
  if (!twenty) return { ok: false, reason: "no_twenty" };

  // 1. Recharge les companies depuis Twenty. On les charge une par une : la
  //    quantité est bornée par ce que l'humain a coché à la main (dizaines,
  //    quelques centaines au plus). Faire un getCompany par id garantit que
  //    la donnée est fraîche même si Twenty a bougé entre la sélection et
  //    l'enfilement.
  const companies: TwentyCompany[] = [];
  const notFound: string[] = [];
  let notFoundNull = 0;
  let notFoundThrow = 0;
  for (const id of campaign.targetCompanyIds) {
    try {
      const c = await twenty.getCompany(id);
      if (c) companies.push(c);
      else {
        notFound.push(id);
        notFoundNull++;
      }
    } catch (err) {
      logger.warn("mailing.campaign.twenty_fetch_failed", {
        campaignId,
        contactId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      notFound.push(id);
      notFoundThrow++;
    }
  }
  if (notFound.length > 0) {
    logger.warn("mailing.campaign.get_company_missing", {
      campaignId,
      totalMissing: notFound.length,
      nullReturn: notFoundNull,
      thrown: notFoundThrow,
    });
  }

  const [metas, alreadyIds, blocks] = await Promise.all([
    listMetaByIds(companies.map((c) => c.id)),
    findCampaignRecipientIds(campaignId),
    listBlocksByIds(campaign.blockIds),
  ]);

  const audience = computeCampaignAudience({
    contacts: companies.map((c) => ({ company: c, meta: metas.get(c.id) ?? null })),
    alreadyRecipientIds: alreadyIds,
  });

  let enqueued = 0;
  let duplicates = 0;
  let noEmail = 0;
  let excluded = 0;
  let notFoundCount = notFound.length;
  const excludedByReason: Partial<Record<ExclusionReason, number>> = {};
  let errors = 0;

  for (const decision of audience) {
    if (!decision.eligible) {
      excluded++;
      if (decision.reason) {
        excludedByReason[decision.reason] = (excludedByReason[decision.reason] ?? 0) + 1;
      }
      continue;
    }
    const company = companies.find((c) => c.id === decision.companyId);
    if (!company) {
      // Ne devrait pas arriver : `audience` est construit à partir de
      // `companies`. Traité comme notFound par prudence.
      notFoundCount++;
      continue;
    }
    const email = company.contactEmail?.primaryEmail ?? null;
    if (!email) {
      noEmail++;
      continue;
    }

    try {
      const greeting = await safeGreeting(company, opts);
      const subject = campaign.subject;
      const body = renderCampaignBody({ greeting, body: campaign.body, blocks });

      const res: EnqueueResult = await enqueueRow({
        companyId: company.id,
        kind: "campaign",
        sequenceStep: null,
        campaignId,
        priority: 3,
        subject,
        body,
        snapshot: { name: company.name, email, greeting },
        // §6.5 — une campagne part en NOUVEAU FIL, jamais greffée sur l'intro.
        threading: null,
      });

      if (res.duplicate) duplicates++;
      else enqueued++;
    } catch (err) {
      errors++;
      logger.warn("mailing.campaign.enqueue_error", {
        campaignId,
        contactId: company.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const total = enqueued + duplicates; // ce qui est effectivement en file (nouveau + déjà présent)
  const now = new Date();
  await setCampaignStatus(campaignId, "queued", { queuedAt: now });
  await setCampaignEnqueueReport(campaignId, {
    candidates: campaign.targetCompanyIds.length,
    enqueued,
    duplicates,
    noEmail,
    notFound: notFoundCount,
    excluded,
    excludedByReason,
    errors,
    at: now,
  });
  await refreshCampaignStats(campaignId);

  logger.info("mailing.campaign.enqueued", {
    campaignId,
    candidates: campaign.targetCompanyIds.length,
    enqueued,
    duplicates,
    noEmail,
    notFound: notFoundCount,
    excluded,
    excludedByReason,
    errors,
    total,
  });

  return {
    ok: true,
    campaignId,
    candidates: campaign.targetCompanyIds.length,
    enqueued,
    duplicates,
    skipped: { noEmail, notFound: notFoundCount, excluded, excludedByReason, errors },
  };
}

async function safeGreeting(
  company: TwentyCompany,
  opts: EnqueueCampaignOpts,
): Promise<string> {
  try {
    return await getOrCreateGreeting(company.id, company.name, {
      client: opts.anthropicClient,
    });
  } catch {
    return GREETING_FALLBACK;
  }
}

/**
 * Rendu de 3 aperçus pour l'UI (§6.4 « aperçu obligatoire »). On tire au sort
 * parmi les éligibles seulement — sinon on n'apprend rien.
 */
export interface CampaignPreview {
  companyId: string;
  companyName: string;
  email: string | null;
  greeting: string;
  subject: string;
  body: string;
}

export async function buildCampaignPreviews(
  campaign: Campaign,
  opts: { twenty?: TwentyClient | null; sampleSize?: number; anthropicClient?: AnthropicClient } = {},
): Promise<CampaignPreview[]> {
  const twenty = opts.twenty === null ? null : (opts.twenty ?? twentyFromEnv());
  if (!twenty) return [];
  if (campaign.targetCompanyIds.length === 0) return [];

  const sampleSize = Math.min(opts.sampleSize ?? 3, campaign.targetCompanyIds.length);

  // On charge tout, filtre l'éligible, puis échantillonne. Bornée par
  // targetCompanyIds — dizaines à centaines.
  const companies: TwentyCompany[] = [];
  for (const id of campaign.targetCompanyIds) {
    try {
      const c = await twenty.getCompany(id);
      if (c) companies.push(c);
    } catch {
      // ignore, l'aperçu est best-effort
    }
  }
  const [metas, alreadyIds, blocks] = await Promise.all([
    listMetaByIds(companies.map((c) => c.id)),
    findCampaignRecipientIds(campaign._id),
    listBlocksByIds(campaign.blockIds),
  ]);
  const audience = computeCampaignAudience({
    contacts: companies.map((c) => ({ company: c, meta: metas.get(c.id) ?? null })),
    alreadyRecipientIds: alreadyIds,
  });
  const eligible = audience.filter((a) => a.eligible && a.email);
  if (eligible.length === 0) return [];

  // Tirage sans remise
  const pool = [...eligible];
  const picked: typeof eligible = [];
  while (picked.length < sampleSize && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]!);
  }

  const previews: CampaignPreview[] = [];
  for (const decision of picked) {
    const company = companies.find((c) => c.id === decision.companyId);
    if (!company) continue;
    const greeting = await safeGreeting(company, opts);
    const body = renderCampaignBody({ greeting, body: campaign.body, blocks });
    previews.push({
      companyId: company.id,
      companyName: company.name,
      email: company.contactEmail?.primaryEmail ?? null,
      greeting,
      subject: campaign.subject,
      body,
    });
  }
  return previews;
}
