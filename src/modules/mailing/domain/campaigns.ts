import { z } from "zod";

// CDC-02 §4.4 — modèle et transitions d'une campagne.
//
// Cycle de vie :
//   draft      → édition libre (sujet, corps, blocs, cibles)
//   queued     → figée ; les N entrées mail_queue sont créées et s'écoulent
//                au rythme du quota (priorité 3, derrière la séquence auto)
//   sending    → au moins un envoi effectif (marqueur d'observabilité)
//   done       → toutes les entrées de la file sont sent/cancelled/failed
//   cancelled  → l'humain a stoppé (les pending restantes sont annulées)

export const CAMPAIGN_STATUSES = [
  "draft",
  "queued",
  "sending",
  "done",
  "cancelled",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const campaignInputSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20_000),
  blockIds: z.array(z.string()).default([]),
  // Sélectionnés à la main dans l'UI (§6.4). L'éligibilité est ré-appliquée
  // côté serveur au moment du "Mettre en file" : forcer un id ici ne le fait
  // pas passer.
  targetCompanyIds: z.array(z.string()).default([]),
});
export type CampaignInput = z.infer<typeof campaignInputSchema>;

export const campaignStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  enqueued: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});
export type CampaignStats = z.infer<typeof campaignStatsSchema>;

export const EMPTY_STATS: CampaignStats = {
  total: 0,
  enqueued: 0,
  sent: 0,
  failed: 0,
  cancelled: 0,
};

// Ventilation persistée du résultat de la mise en file. On sépare `notFound`
// (Twenty n'a pas rendu le contact au moment T) de `excluded` (l'audience a
// répondu eligible=false) et on garde le détail par motif dans
// `excludedByReason` — c'est ce qui permet de diagnostiquer un décalage
// `candidates` vs `enqueued` sans devoir replonger dans les logs.
// `ineligible` est conservé pour rétrocompat : rapports pré-migration où
// notFound + excluded étaient additionnés en un seul compteur.
export const campaignEnqueueReportSchema = z.object({
  candidates: z.number().int().nonnegative(),
  enqueued: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  noEmail: z.number().int().nonnegative(),
  notFound: z.number().int().nonnegative().optional(),
  excluded: z.number().int().nonnegative().optional(),
  excludedByReason: z.record(z.string(), z.number().int().nonnegative()).optional(),
  ineligible: z.number().int().nonnegative().optional(),
  errors: z.number().int().nonnegative(),
  at: z.date(),
});
export type CampaignEnqueueReport = z.infer<typeof campaignEnqueueReportSchema>;

export const campaignSchema = campaignInputSchema.extend({
  _id: z.string(),
  status: z.enum(CAMPAIGN_STATUSES),
  stats: campaignStatsSchema,
  enqueueReport: campaignEnqueueReportSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  queuedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
});
export type Campaign = z.infer<typeof campaignSchema>;

// Raisons d'exclusion — utilisées par le compositeur pour AFFICHER pourquoi
// une case est verrouillée (§6.4 : « exclusions affichées et verrouillées »).
// La liste est FERMÉE : chaque nouveau motif d'exclusion doit être nommé.
export const EXCLUSION_REASONS = [
  "partenaire", // §6.4 : jamais de PARTENAIRE
  "not_prospect_client", // status hors {PROSPECT, CLIENT}
  "prospect_low_followup", // PROSPECT avec followupCount < 3
  "paused", // company_meta.paused
  "hard_bounce", // company_meta.bounce.kind = 'hard'
  "already_received", // déjà présent en file ou en log pour cette campagne
  "not_found", // getCompany a échoué (null 404 ou throw) — l'id n'est plus
  //             adressable dans Twenty. Verrouille la case dans l'UI au lieu
  //             de laisser cocher un contact qui sera silencieusement rejeté
  //             à l'enfilement.
  // Note : isAutoHandled=false n'est PAS une exclusion en campagne (§6.4
  // révisé). C'est un avertissement affiché — l'humain assume. Le kill-switch
  // continue de bloquer la séquence auto (voir eligibility-tick).
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];
