import { connectDb } from "@/modules/shared/db/mongoose";
import { getMailSettings } from "@/modules/mailing/repositories/mail-settings-repo";
import { getSharedAnthropicClient } from "@/modules/shared/anthropic/client";

// Diagnostic : que retourne RÉELLEMENT le modèle pour un nom d'école,
// avec le systemPrompt actuellement stocké en base ? On imprime la sortie
// brute (avant sanitizer) et le prompt utilisé.
//
// Usage : npx tsx --env-file=.env scripts/debug-greeting.ts [nom1] [nom2] ...
//   → si aucun nom fourni, on utilise une batterie de cas école typiques.

const DEFAULT_NAMES = [
  "Mindtechub",
  "École 42",
  "OpenClassrooms",
  "O'Clock",
  "lereacteur",
  "Le Wagon",
  "Ada Tech School",
];

async function main(): Promise<void> {
  const names = process.argv.slice(2);
  const targets = names.length > 0 ? names : DEFAULT_NAMES;

  await connectDb();
  const settings = await getMailSettings();
  const g = settings.greeting;

  console.log("=== systemPrompt actuellement en base ===");
  console.log(g.systemPrompt);
  console.log("");
  console.log(`model=${g.model} · temperature=${g.temperature} · maxTokens=${g.maxTokens}`);
  console.log("");
  console.log("=== Sorties brutes du modèle ===");

  const client = getSharedAnthropicClient();
  for (const name of targets) {
    try {
      const res = await client.call({
        system: g.systemPrompt,
        user: name,
        model: g.model,
        temperature: g.temperature,
        maxTokens: g.maxTokens,
      });
      console.log(`\n[${name}]`);
      console.log(`  raw   : ${JSON.stringify(res.text)}`);
    } catch (err) {
      console.log(`\n[${name}] ERREUR : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
