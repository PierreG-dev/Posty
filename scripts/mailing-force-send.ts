import { connectDb } from "@/modules/shared/db/mongoose";
import { runSendLoop } from "@/modules/mailing/services/send-tick";

// One-shot : appelle runSendLoop() qui bypass la fenêtre horaire, pour
// rattraper un slot raté. Respecte le quota quotidien, le jitter et le
// lock global — donc safe même si le worker tick tourne en parallèle.
//
// Usage prod (dans le container) :
//   node dist-worker/scripts/mailing-force-send.js
// Usage dev :
//   npx tsx --env-file=.env scripts/mailing-force-send.ts

async function main(): Promise<void> {
  await connectDb();
  console.log("mailing-force-send: appel runSendLoop() (bypass window)…");
  const result = await runSendLoop();
  console.log("Résultat :", JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
