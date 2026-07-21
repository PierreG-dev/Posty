import { connectDb } from "@/modules/shared/db/mongoose";
import { MailQueueModel } from "@/modules/mailing/repositories/mail-queue-model";
import { MailLogModel } from "@/modules/mailing/repositories/mail-log-model";

// Sanity check : que trouve-t-on RÉELLEMENT dans mail_queue et mail_log pour
// un campaignId donné ? À croiser avec les stats de la campagne et le retour
// de `findCampaignRecipientIds`.
//
// Usage : npx tsx --env-file=.env scripts/debug-campaign-queue.ts <campaignId>

async function main(): Promise<void> {
  const campaignId = process.argv[2];
  if (!campaignId) {
    console.error("Usage : npx tsx --env-file=.env scripts/debug-campaign-queue.ts <campaignId>");
    process.exit(1);
  }
  await connectDb();

  const byStatus = await MailQueueModel.aggregate<{ _id: string; count: number }>([
    { $match: { kind: "campaign", campaignId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const total = byStatus.reduce((a, r) => a + r.count, 0);
  console.log(`mail_queue { kind:"campaign", campaignId:"${campaignId}" } : ${total} entrée(s)`);
  for (const r of byStatus) console.log(`  ${r._id.padEnd(10)}: ${r.count}`);
  console.log("");

  const logCount = await MailLogModel.countDocuments({ kind: "campaign", campaignId, dryRun: false });
  console.log(`mail_log { kind:"campaign", campaignId, dryRun:false }    : ${logCount}`);
  console.log("");

  // Cross-check exact avec findCampaignRecipientIds : $ne cancelled
  const queuedDistinct = await MailQueueModel.distinct("companyId", {
    kind: "campaign",
    campaignId,
    status: { $ne: "cancelled" },
  });
  console.log(`distinct(companyId) via query findCampaignRecipientIds : ${queuedDistinct.length}`);

  // Échantillon 5 entrées brutes (pour voir shape réel du campaignId stocké)
  const sample = await MailQueueModel.find({ kind: "campaign", campaignId })
    .limit(3)
    .lean();
  console.log(`\nÉchantillon 3 entrées brutes :`);
  for (const d of sample) {
    console.log(`  _id=${d._id} · companyId=${d.companyId} · status=${d.status} · campaignId=${JSON.stringify(d.campaignId)} (type=${typeof d.campaignId})`);
  }

  // Test contre-nature : chercher par regex partiel pour voir s'il y a un mismatch de type
  const rawCount = await MailQueueModel.countDocuments({ kind: "campaign" });
  console.log(`\nTotal mail_queue { kind:"campaign" } sans filtre campaignId : ${rawCount}`);

  const allCampaignIds = await MailQueueModel.distinct("campaignId", { kind: "campaign" });
  console.log(`campaignIds distincts vus dans mail_queue : ${JSON.stringify(allCampaignIds)}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
