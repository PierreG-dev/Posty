import { DateTime } from "luxon";
import { logger } from "@/modules/shared/logger";
import { PARIS } from "@/modules/shared/luxon";
import { twentyFromEnv } from "@/modules/mailing/twenty";
import type { TwentyClient } from "@/modules/mailing/twenty/types";
import { listMetaByIds } from "@/modules/mailing/repositories/company-meta-repo";
import { enqueueSequence } from "./enqueue";
import type { SequenceStep } from "@/modules/mailing/domain/mail-templates";

// CDC-02 §5 — job d'éligibilité quotidien. Il ENFILE (§5.1), il ne marque pas.
// Décision (§plan) : le job tourne même si settings.paused ou dryRun — les
// deux drapeaux s'expriment à l'envoi, pas à l'éligibilité. Ça permet une
// recette dryRun complète et une reprise instantanée après pause.

export interface EligibilityResult {
  scanned: number;
  enqueued: number;
  skipped: number;
  errors: number;
}

export interface RunEligibilityOpts {
  twenty?: TwentyClient;
  now?: Date;
  limit?: number;
}

/**
 * §5.2 — un contact PROSPECT `isAutoHandled=true` est éligible si :
 *   - non paused ;
 *   - non hard bounce (soft <3 tolérés) ;
 *   - status = PROSPECT (les CLIENT et PARTENAIRE ne reçoivent PAS la
 *     séquence auto — §5.3, décision explicite) ;
 *   - followupCount ∈ {0,1,2} ;
 *   - (pas de nextFollowupAt) OU (today >= nextFollowupAt) en zone Paris.
 * L'index unique { companyId, kind:'sequence', sequenceStep } prend en charge
 * le cas « déjà enfilé le cycle précédent, pas encore envoyé » : duplicate
 * silencieux.
 */
export async function runEligibilityTick(opts: RunEligibilityOpts = {}): Promise<EligibilityResult> {
  const twenty = opts.twenty ?? twentyFromEnv();
  if (!twenty) {
    logger.warn("mailing.eligibility.no_twenty");
    return { scanned: 0, enqueued: 0, skipped: 0, errors: 0 };
  }
  const now = opts.now ?? new Date();
  const today = DateTime.fromJSDate(now).setZone(PARIS).startOf("day");
  const limit = opts.limit ?? 500;

  const { items } = await twenty.listCompanies({ isAutoHandled: true, limit });
  const metas = await listMetaByIds(items.map((c) => c.id));

  let enqueued = 0;
  let skipped = 0;
  let errors = 0;

  for (const c of items) {
    try {
      const meta = metas.get(c.id) ?? null;
      if (meta?.paused) {
        skipped++;
        continue;
      }
      if (meta?.bounce?.kind === "hard") {
        skipped++;
        continue;
      }
      if (c.status !== "PROSPECT") {
        // §5.3 — CLIENT / PARTENAIRE ne sont pas enfilés en séquence.
        skipped++;
        continue;
      }
      if (c.followupCount < 0 || c.followupCount > 2) {
        skipped++;
        continue;
      }
      if (c.nextFollowupAt) {
        const next = DateTime.fromISO(c.nextFollowupAt, { zone: "utc" }).setZone(PARIS).startOf("day");
        if (today < next) {
          skipped++;
          continue;
        }
      }

      const step = c.followupCount as SequenceStep;
      const r = await enqueueSequence(c, step);
      if (r.ok && !r.duplicate) enqueued++;
      else skipped++;
    } catch (err) {
      errors++;
      logger.warn("mailing.eligibility.company_error", {
        companyId: c.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("mailing.eligibility.done", {
    scanned: items.length,
    enqueued,
    skipped,
    errors,
  });
  return { scanned: items.length, enqueued, skipped, errors };
}
