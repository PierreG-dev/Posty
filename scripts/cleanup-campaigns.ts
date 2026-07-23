import { connectDb } from "@/modules/shared/db/mongoose";
import { CampaignModel } from "@/modules/mailing/repositories/campaigns-model";
import { MailQueueModel } from "@/modules/mailing/repositories/mail-queue-model";
import { MailLogModel } from "@/modules/mailing/repositories/mail-log-model";

// One-shot : supprime TOUTES les campagnes + leurs entrées dérivées dans
// mail_queue et mail_log. Ne touche pas à company_meta / mail_blocks / Twenty.
//
// Usage : npx tsx --env-file=.env scripts/cleanup-campaigns.ts

async function counts() {
  return {
    campaigns: await CampaignModel.countDocuments({}),
    mail_queue_campaign: await MailQueueModel.countDocuments({ kind: "campaign" }),
    mail_log_campaign: await MailLogModel.countDocuments({ kind: "campaign" }),
  };
}

async function main(): Promise<void> {
  await connectDb();

  const before = await counts();
  console.log("=== BEFORE ===");
  console.log(before);
  console.log("");

  // Liste des _id et campaignIds pour traçabilité
  const campaignDocs = await CampaignModel.find({}, { _id: 1, name: 1, status: 1, createdAt: 1 }).lean();
  console.log("Campagnes qui vont être supprimées :");
  for (const c of campaignDocs) {
    console.log(`  ${String(c._id)} · ${c.name} · ${c.status} · créée ${(c as { createdAt?: Date }).createdAt?.toISOString() ?? "?"}`);
  }
  console.log("");

  const rLog = await MailLogModel.deleteMany({ kind: "campaign" });
  console.log(`mail_log { kind:"campaign" }   deleted : ${rLog.deletedCount ?? 0}`);
  const rQueue = await MailQueueModel.deleteMany({ kind: "campaign" });
  console.log(`mail_queue { kind:"campaign" } deleted : ${rQueue.deletedCount ?? 0}`);
  const rCamp = await CampaignModel.deleteMany({});
  console.log(`campaigns                       deleted : ${rCamp.deletedCount ?? 0}`);
  console.log("");

  const after = await counts();
  console.log("=== AFTER ===");
  console.log(after);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
