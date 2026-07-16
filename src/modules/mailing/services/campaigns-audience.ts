import type { TwentyCompany } from "@/modules/mailing/twenty/types";
import type { CompanyMeta } from "@/modules/mailing/domain/company-meta";
import type { ExclusionReason } from "@/modules/mailing/domain/campaigns";

// CDC-02 §6.4 — sélection des cibles d'une campagne.
//
// Fonction PURE : reçoit l'état déjà chargé (companies, metas, ids déjà
// destinataires), retourne une décision par contact. Les I/O (Twenty, Mongo)
// vivent dans l'appelant.
//
// Règles (§6.4) :
//   AUTORISÉ : PROSPECT avec followupCount >= 3, ou CLIENT.
//   JAMAIS   : PARTENAIRE.
//   EXCLU AUTOMATIQUEMENT (non contournable) :
//     - paused
//     - hard bounce (soft 3+ traité comme hard côté §8.1 : bounce.kind='hard')
//     - déjà destinataire de cette campagne (queue non-cancelled OU log)
//   AVERTISSEMENT (cochable mais signalé) :
//     - isAutoHandled = false (kill-switch séquence auto). Dans une campagne
//       manuelle, l'humain assume la décision : on affiche le drapeau mais
//       on autorise la sélection. Le kill-switch continue de bloquer la
//       séquence auto (voir eligibility-tick).

export interface AudienceInput {
  company: TwentyCompany;
  meta: CompanyMeta | null;
}

export interface AudienceDecision {
  companyId: string;
  name: string;
  email: string | null;
  status: TwentyCompany["status"];
  followupCount: number;
  eligible: boolean;
  reason: ExclusionReason | null;
  // Drapeau informatif (non bloquant en campagne) : Twenty.isAutoHandled=false.
  // L'UI l'affiche pour prévenir l'humain, mais la case reste cochable.
  autoHandledOff: boolean;
  // Aperçu de la salutation cachée pour l'UI (peut être null si non calculée
  // encore ; la génération se fait à l'enfilement, pas dans l'audit).
  greetingPreview: string | null;
}

export interface ComputeAudienceOpts {
  contacts: readonly AudienceInput[];
  alreadyRecipientIds: ReadonlySet<string>;
}

/**
 * Applique les règles d'éligibilité à une liste de contacts. Chaque contact
 * ressort avec `eligible + reason` — l'UI affiche les exclusions verrouillées,
 * l'API les ré-applique. Un contact éligible avec `email === null` reste
 * éligible ici (on veut le montrer) mais sera rejeté à l'enfilement.
 */
export function computeCampaignAudience(opts: ComputeAudienceOpts): AudienceDecision[] {
  return opts.contacts.map(({ company, meta }) => {
    const base = {
      companyId: company.id,
      name: company.name,
      email: company.contactEmail?.primaryEmail ?? null,
      status: company.status,
      followupCount: company.followupCount,
      greetingPreview: meta?.greeting ?? null,
    };

    const reason = decide(company, meta, opts.alreadyRecipientIds);
    return {
      ...base,
      eligible: reason === null,
      reason,
      autoHandledOff: company.isAutoHandled === false,
    };
  });
}

function decide(
  company: TwentyCompany,
  meta: CompanyMeta | null,
  alreadyRecipientIds: ReadonlySet<string>,
): ExclusionReason | null {
  // Ordre choisi : d'abord les exclusions STRUCTURELLES (statut, followup),
  // ensuite les exclusions D'ÉTAT (paused, bounce, kill-switch), enfin la
  // déduplication. Ça donne un motif stable et pertinent en cas de cumul.

  if (company.status === "PARTENAIRE") return "partenaire";
  if (company.status !== "PROSPECT" && company.status !== "CLIENT") {
    return "not_prospect_client";
  }
  if (company.status === "PROSPECT" && company.followupCount < 3) {
    return "prospect_low_followup";
  }
  if (meta?.paused) return "paused";
  if (meta?.bounce?.kind === "hard") return "hard_bounce";
  if (alreadyRecipientIds.has(company.id)) return "already_received";
  return null;
}

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  partenaire: "PARTENAIRE — jamais ciblé",
  not_prospect_client: "Ni PROSPECT ni CLIENT",
  prospect_low_followup: "PROSPECT avec < 3 relances",
  paused: "En pause (a répondu ou pausé à la main)",
  hard_bounce: "Hard bounce",
  already_received: "Déjà destinataire de cette campagne",
};

export const AUTO_HANDLED_OFF_LABEL = "Auto-handled OFF";
