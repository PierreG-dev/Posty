import { listPublications } from "@/modules/linkedin/repositories/publication-repo";
import { HistoryTable } from "@/modules/linkedin/ui/history-table";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const publications = await listPublications({ limit: 200 });
  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Historique</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Journal d&apos;exécution des publications (§6.5). Filtrable par
          résultat. Les entrées <span className="font-mono">skipped</span>{" "}
          proviennent du mode dryRun.
        </p>
      </header>
      <HistoryTable initial={publications} />
    </div>
  );
}
