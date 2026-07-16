// =============================================================================
// scripts/migrate-from-sheets.ts — CDC-01 §16
// =============================================================================
//
// Importe l'export CSV du Google Sheets actuel. IDEMPOTENT via `sourceExternalId`
// (index unique sparse ajouté au modèle `posts`, cf. lot 02 §Décisions).
//
// Colonnes CSV attendues (l'export Sheets tel qu'il est aujourd'hui) :
//   id           — identifiant unique de la ligne (ex: "42")
//   contenu      — texte du post (peut contenir des sauts de ligne)
//   hashtags     — hashtags séparés par des espaces (optionnel)
//   statut       — "À publier" ou "Publié ✅"
//   date_publie  — format fr-FR (ex: "12/03/2025") — pertinent seulement si statut = publié
//
// Mapping :
//   "À publier"  → status='queued', queuePosition = ordre du CSV
//   "Publié ✅"  → status='published', publishedAt parsé
//   themeId      → null (à assigner en masse dans l'UI après import)
//   source       → 'sheets-migration'
//
// Usage :
//   tsx --env-file-if-exists=.env.local scripts/migrate-from-sheets.ts --file=export.csv --dry
//   tsx --env-file-if-exists=.env.local scripts/migrate-from-sheets.ts --file=export.csv --live
// =============================================================================

import { parse } from "csv-parse/sync";
import { readFile } from "node:fs/promises";
import { DateTime } from "luxon";
import { connectDb } from "@/modules/shared/db/mongoose";
import { PostModel } from "@/modules/linkedin/repositories/post-model";
import { logger } from "@/modules/shared/logger";

interface CsvRow {
  id?: string;
  contenu?: string;
  hashtags?: string;
  statut?: string;
  date_publie?: string;
}

interface Cli {
  file: string;
  live: boolean;
}

function parseCli(): Cli {
  const args = process.argv.slice(2);
  const has = (f: string) => args.includes(f);
  const get = (f: string): string | undefined => {
    const a = args.find((x) => x.startsWith(`${f}=`));
    return a ? a.slice(f.length + 1) : undefined;
  };
  const file = get("--file");
  if (!file) {
    throw new Error("Usage : tsx scripts/migrate-from-sheets.ts --file=<path.csv> [--live]");
  }
  const dry = has("--dry");
  const live = has("--live");
  if (dry && live) throw new Error("--dry et --live sont mutuellement exclusifs");
  return { file, live };
}

function parseFrDate(s: string | undefined): Date | null {
  if (!s || !s.trim()) return null;
  // Accepte "12/03/2025" ou "12/03/2025 09:00" ou "2025-03-12".
  const trimmed = s.trim();
  const candidates = [
    DateTime.fromFormat(trimmed, "dd/LL/yyyy HH:mm", { zone: "Europe/Paris" }),
    DateTime.fromFormat(trimmed, "dd/LL/yyyy", { zone: "Europe/Paris" }),
    DateTime.fromISO(trimmed, { zone: "Europe/Paris" }),
  ];
  for (const c of candidates) if (c.isValid) return c.toUTC().toJSDate();
  return null;
}

function parseHashtags(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .split(/\s+/)
    .map((h) => h.trim())
    .filter(Boolean)
    .filter((h) => /^#[A-Za-z0-9_]+$/.test(h));
}

async function main(): Promise<void> {
  const cli = parseCli();
  const csv = await readFile(cli.file, "utf8");
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as CsvRow[];

  logger.info("migrate.start", { file: cli.file, rows: rows.length, mode: cli.live ? "live" : "dry" });

  let queuePosCounter = 0;
  let toInsert = 0;
  let skippedNoId = 0;
  let skippedNoContent = 0;
  let alreadyPresent = 0;
  const preview: Array<{ id: string; status: string; contentPreview: string }> = [];

  if (cli.live) await connectDb();

  for (const row of rows) {
    const extId = (row.id ?? "").trim();
    if (!extId) {
      skippedNoId += 1;
      continue;
    }
    const content = (row.contenu ?? "").trim();
    if (!content) {
      skippedNoContent += 1;
      continue;
    }
    const statutRaw = (row.statut ?? "").trim();
    const isPublished = statutRaw.includes("Publié") || statutRaw.includes("✅");
    const status = isPublished ? "published" : "queued";
    const publishedAt = isPublished ? parseFrDate(row.date_publie) : null;
    const hashtags = parseHashtags(row.hashtags);
    const queuePosition = status === "queued" ? queuePosCounter++ : 0;

    const doc = {
      content,
      hashtags,
      themeId: null,
      status,
      source: "sheets-migration" as const,
      media: { kind: "none" as const, assetId: null, altText: "", title: "" },
      firstComment: { text: null, status: "none" as const, urn: null, error: null },
      queuePosition,
      scheduledAt: null,
      publishedAt,
      linkedin: { urn: null, url: null },
      attempts: 0,
      lastError: null,
      aiMeta: null,
      sourceExternalId: extId,
    };

    if (cli.live) {
      try {
        await PostModel.create(doc);
        toInsert += 1;
      } catch (err) {
        if (isDuplicate(err)) {
          alreadyPresent += 1;
        } else {
          logger.error("migrate.insert.error", { id: extId, err: String(err) });
        }
      }
    } else {
      // Dry : simule la présence via query.
      const existing = await countExistingDry(extId);
      if (existing > 0) alreadyPresent += 1;
      else toInsert += 1;
      if (preview.length < 5) {
        preview.push({ id: extId, status, contentPreview: content.slice(0, 60) + (content.length > 60 ? "…" : "") });
      }
    }
  }

  logger.info("migrate.done", {
    rows: rows.length,
    inserted: cli.live ? toInsert : 0,
    would_insert: !cli.live ? toInsert : undefined,
    already_present: alreadyPresent,
    skipped_no_id: skippedNoId,
    skipped_no_content: skippedNoContent,
  });

  if (!cli.live) {
    console.log("\nAperçu (5 premiers) :");
    for (const p of preview) console.log(`  #${p.id.padEnd(6)} ${p.status.padEnd(10)} ${p.contentPreview}`);
    console.log("\n⚠️  DRY-RUN : rien n'a été écrit. Ré-exécute avec --live pour insérer.");
  } else {
    console.log("\n✓ Migration terminée.");
    console.log("→ Étape suivante : va dans /linkedin/posts, filtre par 'Sans thème', sélectionne le lot,");
    console.log("  clique « Assigner un thème » pour classer les posts migrés.");
  }
  process.exit(0);
}

function isDuplicate(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: number };
  return e.code === 11000;
}

async function countExistingDry(extId: string): Promise<number> {
  // Pas de connexion Mongo en dry : on renvoie 0 (impossible à savoir sans DB).
  // Le vrai comptage se fait en --live via l'index unique.
  void extId;
  return 0;
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
