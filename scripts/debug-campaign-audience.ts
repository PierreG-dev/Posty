import { connectDb } from "@/modules/shared/db/mongoose";
import { getCampaign } from "@/modules/mailing/repositories/campaigns-repo";
import { twentyFromEnv } from "@/modules/mailing/twenty";

// Rejoue `getCompany` sur les targetCompanyIds d'une campagne et catégorise
// chaque résultat : ok / null (payload sans data.company ou 404) / throw.
// Sert à diagnostiquer un écart `enqueueReport.ineligible` inexpliqué.
//
// Usage : npx tsx --env-file=.env scripts/debug-campaign-audience.ts <campaignId>

async function main(): Promise<void> {
  const campaignId = process.argv[2];
  if (!campaignId) {
    console.error("Usage : npx tsx --env-file=.env scripts/debug-campaign-audience.ts <campaignId>");
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
  console.log(`Cibles à sonder : ${ids.length}`);
  console.log(`enqueueReport en base : ${campaign.enqueueReport ? JSON.stringify(campaign.enqueueReport) : "(absent)"}`);
  console.log("");

  const ok: string[] = [];
  const nullReturn: string[] = [];
  const thrown: Array<{ id: string; error: string }> = [];

  for (const id of ids) {
    try {
      const c = await twenty.getCompany(id);
      if (c) ok.push(id);
      else nullReturn.push(id);
    } catch (err) {
      thrown.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(`ok     : ${ok.length}`);
  console.log(`null   : ${nullReturn.length}  (404 OU payload sans data.company)`);
  console.log(`throw  : ${thrown.length}`);
  console.log("");

  if (nullReturn.length > 0) {
    console.log("Ids qui renvoient null (échantillon max 10) :");
    for (const id of nullReturn.slice(0, 10)) console.log(`  ${id}`);
    console.log("");
    console.log("→ Passe-les à `scripts/probe-twenty-single.ts` pour voir le corps brut.");
  }

  if (thrown.length > 0) {
    console.log("Ids qui throw (échantillon max 5) :");
    for (const t of thrown.slice(0, 5)) console.log(`  ${t.id} : ${t.error}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
