// =============================================================================
// scripts/compare-with-n8n.ts — CDC-02 §12 (lot M5) et §13
// =============================================================================
//
// Outil de bascule. Posty tourne en `settings.dryRun=true` EN PARALLÈLE des
// workflows n8n toujours actifs. Ce script compare, sur une période donnée :
//
//   - CE QUE POSTY AURAIT ENVOYÉ  : `mail_log` filtré `dryRun=true`, plus les
//     entrées `mail_queue` en `pending` datées de la période.
//   - CE QUE N8N A RÉELLEMENT ENVOYÉ : reflété par l'état actuel de Twenty
//     (`lastContactedAt`, `followupCount`, `lastMessageId`).
//
// Zéro écart = feu vert pour couper n8n.
//
// STRICTEMENT READ-ONLY. Jamais de PATCH, jamais d'envoi.
//
// USAGE
//   tsx scripts/compare-with-n8n.ts --posty-side  --from=2026-07-01 --to=2026-07-15 [--out=report.json]
//   tsx scripts/compare-with-n8n.ts --twenty-side --from=2026-07-01 --to=2026-07-15 [--out=report.json]
//   tsx scripts/compare-with-n8n.ts --compare \
//       --posty=posty.json --twenty=twenty.json [--out=diff.json]
//
// FUSEAU : les dates --from / --to sont interprétées en Europe/Paris (bornes
// [00:00 Paris, 23:59 Paris]), c'est le fuseau de tout le reste de l'app.
// =============================================================================

import { readFile, writeFile } from "node:fs/promises";
import { DateTime } from "luxon";
import { connectDb, mongoose } from "@/modules/shared/db/mongoose";
import { MailLogModel } from "@/modules/mailing/repositories/mail-log-model";
import { MailQueueModel } from "@/modules/mailing/repositories/mail-queue-model";
import { twentyFromEnv } from "@/modules/mailing/twenty";
import { logger } from "@/modules/shared/logger";

// ─── CLI ────────────────────────────────────────────────────────────────────

interface Cli {
  mode: "posty-side" | "twenty-side" | "compare";
  from?: string;
  to?: string;
  out?: string;
  postyFile?: string;
  twentyFile?: string;
}

function parseCli(): Cli {
  const args = process.argv.slice(2);
  const has = (f: string) => args.includes(f);
  const get = (f: string): string | undefined => {
    const a = args.find((x) => x.startsWith(`${f}=`));
    return a ? a.slice(f.length + 1) : undefined;
  };
  const modes = [has("--posty-side"), has("--twenty-side"), has("--compare")];
  const count = modes.filter(Boolean).length;
  if (count !== 1) {
    throw new Error("Choisir EXACTEMENT un mode : --posty-side | --twenty-side | --compare");
  }
  const mode: Cli["mode"] = has("--posty-side")
    ? "posty-side"
    : has("--twenty-side")
      ? "twenty-side"
      : "compare";
  return {
    mode,
    from: get("--from"),
    to: get("--to"),
    out: get("--out"),
    postyFile: get("--posty"),
    twentyFile: get("--twenty"),
  };
}

function parseWindow(from: string | undefined, to: string | undefined): { start: Date; end: Date } {
  if (!from || !to) throw new Error("--from=YYYY-MM-DD et --to=YYYY-MM-DD requis");
  const s = DateTime.fromISO(from, { zone: "Europe/Paris" }).startOf("day");
  const e = DateTime.fromISO(to, { zone: "Europe/Paris" }).endOf("day");
  if (!s.isValid || !e.isValid) throw new Error("Dates invalides (format ISO YYYY-MM-DD attendu)");
  if (e < s) throw new Error("--to est avant --from");
  return { start: s.toUTC().toJSDate(), end: e.toUTC().toJSDate() };
}

// ─── Modèle d'échange normalisé ─────────────────────────────────────────────

/**
 * Une intention d'envoi de séquence, telle qu'elle peut être observée des DEUX
 * côtés. On ne compare QUE la séquence (§5.3 : campagnes = n'existent pas
 * dans n8n, elles sont hors comparaison).
 *
 * `sequenceStep` est ce que Posty ENFILE : 0 = premier contact, 1 = relance 1,
 * 2 = relance 2. Côté Twenty, on le déduit de `followupCount` : après un envoi
 * step N, `followupCount` devient N+1. On stocke donc `sequenceStep` = valeur
 * enfilée, i.e. `followupCount` observé - 1.
 */
interface SequenceEvent {
  companyId: string;
  companyName?: string;
  sequenceStep: number; // 0, 1, 2
  sentAt: string; // ISO UTC — pour Posty : mail_log.sentAt, pour Twenty : lastContactedAt
  lastMessageId?: string | null;
  source: "posty" | "twenty";
}

interface SideReport {
  side: "posty" | "twenty";
  window: { from: string; to: string };
  generatedAt: string;
  events: SequenceEvent[];
}

// ─── Côté Posty ─────────────────────────────────────────────────────────────

async function collectPostySide(cli: Cli): Promise<SideReport> {
  const { start, end } = parseWindow(cli.from, cli.to);
  await connectDb();
  // On lit `mail_log` (dryRun=true) : c'est le journal des envois SIMULÉS
  // qu'a produits la boucle §6.2 sans appeler SMTP. C'est le reflet fidèle de
  // ce que Posty AURAIT fait.
  const logs = await MailLogModel.find({
    dryRun: true,
    kind: "sequence",
    sentAt: { $gte: start, $lte: end },
  })
    .lean()
    .exec();

  const events: SequenceEvent[] = logs
    .filter((l) => typeof l.sequenceStep === "number")
    .map((l) => ({
      companyId: l.companyId,
      sequenceStep: l.sequenceStep as number,
      sentAt: new Date(l.sentAt).toISOString(),
      source: "posty" as const,
    }));

  // On surface aussi les entrées en attente sur la fenêtre (utile pour
  // diagnostiquer un job qui n'aurait pas tourné).
  const pending = await MailQueueModel.find({
    kind: "sequence",
    status: "pending",
    createdAt: { $gte: start, $lte: end },
  })
    .lean()
    .exec();

  logger.info("compare.posty.done", {
    logs: logs.length,
    events: events.length,
    pending_still_in_queue: pending.length,
  });

  return {
    side: "posty",
    window: { from: cli.from!, to: cli.to! },
    generatedAt: new Date().toISOString(),
    events,
  };
}

// ─── Côté Twenty (= ce que n8n a fait) ──────────────────────────────────────

async function collectTwentySide(cli: Cli): Promise<SideReport> {
  const { start, end } = parseWindow(cli.from, cli.to);
  const client = twentyFromEnv();
  if (!client) throw new Error("TWENTY_API_URL / TWENTY_API_KEY absents de l'env");

  const events: SequenceEvent[] = [];
  let cursor: string | null | undefined = null;
  let total = 0;

  // On paginé `listCompanies({ isAutoHandled: true })`. Le filtrage sur la
  // fenêtre est fait ici (Twenty REST n'expose pas de filtre range portable).
  do {
    const res = await client.listCompanies({ isAutoHandled: true, limit: 100, cursor });
    for (const c of res.items) {
      total += 1;
      if (!c.lastContactedAt) continue;
      const t = new Date(c.lastContactedAt);
      if (isNaN(t.getTime())) continue;
      if (t < start || t > end) continue;
      // followupCount reflète l'état APRÈS envoi. Le step enfilé = fc - 1.
      // Si fc == 0, aucune séquence n'est encore partie → on skippe.
      if (c.followupCount <= 0) continue;
      const step = Math.min(2, c.followupCount - 1); // clampé, comme n8n (§1.2)
      events.push({
        companyId: c.id,
        companyName: c.name,
        sequenceStep: step,
        sentAt: t.toISOString(),
        lastMessageId: c.lastMessageId,
        source: "twenty",
      });
    }
    cursor = res.nextCursor;
  } while (cursor);

  logger.info("compare.twenty.done", { scanned: total, events: events.length });

  return {
    side: "twenty",
    window: { from: cli.from!, to: cli.to! },
    generatedAt: new Date().toISOString(),
    events,
  };
}

// ─── Diff ───────────────────────────────────────────────────────────────────

interface DiffLine {
  companyId: string;
  companyName?: string;
  sequenceStep: number;
  kind: "missing_in_posty" | "extra_in_posty" | "step_mismatch" | "date_drift";
  detail: string;
}

interface DiffReport {
  generatedAt: string;
  postyWindow: { from: string; to: string };
  twentyWindow: { from: string; to: string };
  counts: {
    posty: number;
    twenty: number;
    missing_in_posty: number;
    extra_in_posty: number;
    step_mismatch: number;
    date_drift: number;
  };
  lines: DiffLine[];
  verdict: "green" | "red";
}

function keyOf(e: SequenceEvent): string {
  return `${e.companyId}#${e.sequenceStep}`;
}

function diff(posty: SideReport, twenty: SideReport): DiffReport {
  const postyMap = new Map(posty.events.map((e) => [keyOf(e), e]));
  const twentyMap = new Map(twenty.events.map((e) => [keyOf(e), e]));

  const lines: DiffLine[] = [];

  // Manquants côté Posty : n8n a envoyé, Posty n'aurait rien envoyé.
  // C'est le pire cas (des mails perdus après bascule).
  for (const [k, tw] of twentyMap) {
    if (!postyMap.has(k)) {
      // Est-ce un simple décalage de step ?
      const other = posty.events.find((p) => p.companyId === tw.companyId);
      if (other && other.sequenceStep !== tw.sequenceStep) {
        lines.push({
          companyId: tw.companyId,
          companyName: tw.companyName,
          sequenceStep: tw.sequenceStep,
          kind: "step_mismatch",
          detail: `n8n a envoyé step=${tw.sequenceStep}, Posty aurait envoyé step=${other.sequenceStep}`,
        });
      } else {
        lines.push({
          companyId: tw.companyId,
          companyName: tw.companyName,
          sequenceStep: tw.sequenceStep,
          kind: "missing_in_posty",
          detail: `n8n envoyé le ${tw.sentAt} ; Posty n'a rien enfilé pour ce step`,
        });
      }
    }
  }

  // En trop côté Posty : Posty aurait envoyé, n8n n'a rien fait.
  // Moins grave (double envoi possible si on bascule mal), mais à traiter.
  for (const [k, ps] of postyMap) {
    if (!twentyMap.has(k)) {
      const other = twenty.events.find((t) => t.companyId === ps.companyId);
      if (other && other.sequenceStep !== ps.sequenceStep) continue; // déjà logué en step_mismatch
      lines.push({
        companyId: ps.companyId,
        sequenceStep: ps.sequenceStep,
        kind: "extra_in_posty",
        detail: `Posty aurait envoyé le ${ps.sentAt} ; n8n n'a rien fait`,
      });
    }
  }

  // Dérives de date (> 3 jours) sur les paires alignées.
  for (const [k, ps] of postyMap) {
    const tw = twentyMap.get(k);
    if (!tw) continue;
    const dPs = new Date(ps.sentAt).getTime();
    const dTw = new Date(tw.sentAt).getTime();
    const deltaDays = Math.abs(dPs - dTw) / (1000 * 3600 * 24);
    if (deltaDays > 3) {
      lines.push({
        companyId: ps.companyId,
        companyName: tw.companyName,
        sequenceStep: ps.sequenceStep,
        kind: "date_drift",
        detail: `écart ${deltaDays.toFixed(1)} j (posty ${ps.sentAt} vs twenty ${tw.sentAt})`,
      });
    }
  }

  const counts = {
    posty: posty.events.length,
    twenty: twenty.events.length,
    missing_in_posty: lines.filter((l) => l.kind === "missing_in_posty").length,
    extra_in_posty: lines.filter((l) => l.kind === "extra_in_posty").length,
    step_mismatch: lines.filter((l) => l.kind === "step_mismatch").length,
    date_drift: lines.filter((l) => l.kind === "date_drift").length,
  };

  return {
    generatedAt: new Date().toISOString(),
    postyWindow: posty.window,
    twentyWindow: twenty.window,
    counts,
    lines,
    verdict: lines.length === 0 ? "green" : "red",
  };
}

async function runCompare(cli: Cli): Promise<DiffReport> {
  if (!cli.postyFile || !cli.twentyFile) {
    throw new Error("--compare exige --posty=<fichier.json> et --twenty=<fichier.json>");
  }
  const [postyRaw, twentyRaw] = await Promise.all([
    readFile(cli.postyFile, "utf8"),
    readFile(cli.twentyFile, "utf8"),
  ]);
  const posty = JSON.parse(postyRaw) as SideReport;
  const twenty = JSON.parse(twentyRaw) as SideReport;
  if (posty.side !== "posty" || twenty.side !== "twenty") {
    throw new Error("Fichiers inversés : --posty attend un rapport 'posty', --twenty un 'twenty'");
  }
  return diff(posty, twenty);
}

function printDiff(report: DiffReport): void {
  const c = report.counts;
  console.log(`\n=== Comparaison Posty / n8n ===`);
  console.log(`Posty  : ${c.posty} envois simulés`);
  console.log(`Twenty : ${c.twenty} envois observés`);
  console.log(`\nÉcarts :`);
  console.log(`  manquants côté Posty (n8n envoyé, Posty non) : ${c.missing_in_posty}`);
  console.log(`  en trop côté Posty  (Posty envoyé, n8n non) : ${c.extra_in_posty}`);
  console.log(`  décalages de step                              : ${c.step_mismatch}`);
  console.log(`  dérives de date > 3 j                          : ${c.date_drift}`);
  console.log(`\nVerdict : ${report.verdict === "green" ? "✓ FEU VERT (zéro écart)" : "✗ ÉCARTS — bascule bloquée"}`);
  if (report.lines.length > 0) {
    console.log(`\n5 premiers écarts :`);
    for (const l of report.lines.slice(0, 5)) {
      const name = l.companyName ? ` (${l.companyName})` : "";
      console.log(`  [${l.kind}] ${l.companyId}${name} step=${l.sequenceStep} — ${l.detail}`);
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseCli();

  if (cli.mode === "posty-side") {
    const report = await collectPostySide(cli);
    const out = cli.out ?? "posty-side.json";
    await writeFile(out, JSON.stringify(report, null, 2), "utf8");
    console.log(`✓ ${report.events.length} événements écrits dans ${out}`);
    await mongoose.disconnect();
  } else if (cli.mode === "twenty-side") {
    const report = await collectTwentySide(cli);
    const out = cli.out ?? "twenty-side.json";
    await writeFile(out, JSON.stringify(report, null, 2), "utf8");
    console.log(`✓ ${report.events.length} événements écrits dans ${out}`);
  } else {
    const report = await runCompare(cli);
    printDiff(report);
    if (cli.out) {
      await writeFile(cli.out, JSON.stringify(report, null, 2), "utf8");
      console.log(`\n→ Rapport complet écrit dans ${cli.out}`);
    }
    // Code de sortie ≠ 0 sur écart : utile pour scripter la porte de bascule.
    if (report.verdict === "red") process.exit(2);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
