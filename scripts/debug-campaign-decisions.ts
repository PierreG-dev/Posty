import { connectDb } from "@/modules/shared/db/mongoose";
import { getCampaign, findCampaignRecipientIds } from "@/modules/mailing/repositories/campaigns-repo";
import { listMetaByIds } from "@/modules/mailing/repositories/company-meta-repo";
import { twentyFromEnv } from "@/modules/mailing/twenty";
import { computeCampaignAudience } from "@/modules/mailing/services/campaigns-audience";
import type { TwentyCompany } from "@/modules/mailing/twenty/types";

// Rejoue le pipeline audience COMPLET (getCompany + listMetaByIds +
// findCampaignRecipientIds + computeCampaignAudience) sur les targetCompanyIds
// d'une campagne et catégorise chaque decision par `reason` — pour comprendre
// pourquoi X sur N sont ineligible à l'enfilement.
//
// Usage : npx tsx --env-file=.env scripts/debug-campaign-decisions.ts <campaignId>

async function main(): Promise<void> {
  const campaignId = process.argv[2];
  if (!campaignId) {
    console.error("Usage : npx tsx --env-file=.env scripts/debug-campaign-decisions.ts <campaignId>");
    process.exit(1);
  }

  await connectDb();
  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    console.error(`Campagne introuvable : ${campaignId}`);
    process.exit(1);
  }
  const twenty = twentyFromEnv();
  if (!twenty) {
    console.error("TWENTY_API_URL ou TWENTY_API_KEY manquant dans .env");
    process.exit(1);
  }

  const ids = campaign.targetCompanyIds;
  console.log(`Campagne : ${campaign.name} (${campaign._id})`);
  console.log(`Cibles : ${ids.length}`);
  console.log("");

  const companies: TwentyCompany[] = [];
  for (const id of ids) {
    const c = await twenty.getCompany(id).catch(() => null);
    if (c) companies.push(c);
  }

  const [metas, alreadyIds] = await Promise.all([
    listMetaByIds(companies.map((c) => c.id)),
    findCampaignRecipientIds(campaignId),
  ]);

  console.log(`getCompany réussis    : ${companies.length}/${ids.length}`);
  console.log(`metas trouvées        : ${metas.size}`);
  console.log(`alreadyRecipientIds   : ${alreadyIds.size}  (devrait ≈ nb d'entrées mail_queue pending pour ce campaignId)`);
  console.log("");

  const audience = computeCampaignAudience({
    contacts: companies.map((c) => ({ company: c, meta: metas.get(c.id) ?? null })),
    alreadyRecipientIds: alreadyIds,
  });

  const byReason: Record<string, string[]> = {};
  let eligibleWithEmail = 0;
  let eligibleWithoutEmail = 0;

  for (const d of audience) {
    if (d.eligible) {
      if (d.email) eligibleWithEmail++;
      else eligibleWithoutEmail++;
      continue;
    }
    const key = d.reason ?? "unknown";
    (byReason[key] ??= []).push(`${d.companyId} · ${d.name} · status=${d.status} · followup=${d.followupCount}`);
  }

  const missing = ids.length - companies.length;
  console.log("=== Ventilation ===");
  console.log(`getCompany null/throw : ${missing}`);
  console.log(`eligible + email      : ${eligibleWithEmail}`);
  console.log(`eligible sans email   : ${eligibleWithoutEmail}`);
  for (const [reason, list] of Object.entries(byReason)) {
    console.log(`${reason.padEnd(22)}: ${list.length}`);
  }
  console.log("");
  console.log("Total :", missing + eligibleWithEmail + eligibleWithoutEmail + Object.values(byReason).reduce((a, l) => a + l.length, 0));

  console.log("\n=== Détail par motif (max 8 par catégorie) ===");
  for (const [reason, list] of Object.entries(byReason)) {
    console.log(`\n[${reason}] ${list.length} entrée(s) :`);
    for (const line of list.slice(0, 8)) console.log(`  ${line}`);
    if (list.length > 8) console.log(`  … et ${list.length - 8} autre(s)`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
