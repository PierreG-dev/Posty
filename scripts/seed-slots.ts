// =============================================================================
// scripts/seed-slots.ts — CDC-01 §6.2
// =============================================================================
// Seed des créneaux par défaut : mar 09:00, jeu 12:00, ven 17:30.
// IDEMPOTENT : ne recrée pas un slot déjà présent (matching dayOfWeek+time+themeId).
//
// Usage :
//   tsx --env-file-if-exists=.env.local scripts/seed-slots.ts --theme=<themeSlug>
// =============================================================================

import { connectDb } from "@/modules/shared/db/mongoose";
import { SlotModel } from "@/modules/linkedin/repositories/slot-model";
import { ThemeModel } from "@/modules/linkedin/repositories/theme-model";
import { Types } from "mongoose";

interface SeedSlot {
  label: string;
  dayOfWeek: number;
  time: string;
}

const DEFAULT_SLOTS: SeedSlot[] = [
  { label: "Mardi matin", dayOfWeek: 2, time: "09:00" },
  { label: "Jeudi midi", dayOfWeek: 4, time: "12:00" },
  { label: "Vendredi PM", dayOfWeek: 5, time: "17:30" },
];

function parseArgs(argv: string[]): { themeSlug: string | null } {
  const themeArg = argv.find((a) => a.startsWith("--theme="));
  return { themeSlug: themeArg ? themeArg.slice("--theme=".length) : null };
}

async function main() {
  const { themeSlug } = parseArgs(process.argv.slice(2));
  await connectDb();

  const theme = themeSlug
    ? await ThemeModel.findOne({ slug: themeSlug }).lean()
    : await ThemeModel.findOne({ active: true }).lean();

  if (!theme) {
    console.error(
      themeSlug
        ? `Thème "${themeSlug}" introuvable. Crée-le d'abord dans l'UI.`
        : `Aucun thème actif — crée-en un dans /linkedin/themes puis passe --theme=<slug>.`,
    );
    process.exit(1);
  }

  const themeId = new Types.ObjectId(String(theme._id));
  let created = 0;
  let skipped = 0;

  for (const s of DEFAULT_SLOTS) {
    const existing = await SlotModel.findOne({
      dayOfWeek: s.dayOfWeek,
      time: s.time,
      themeId,
    }).lean();
    if (existing) {
      skipped += 1;
      continue;
    }
    await SlotModel.create({
      label: s.label,
      dayOfWeek: s.dayOfWeek,
      time: s.time,
      themeId,
      modeOverride: null,
      active: true,
    });
    created += 1;
  }

  console.log(`✓ Seed créneaux — thème "${theme.name}" : ${created} créé(s), ${skipped} déjà présent(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
