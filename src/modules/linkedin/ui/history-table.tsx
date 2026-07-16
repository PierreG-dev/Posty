"use client";
import { useMemo, useState } from "react";
import type { Publication } from "@/modules/linkedin/repositories/publication-repo";
import { PUBLICATION_OUTCOMES, type PublicationOutcome } from "@/modules/linkedin/repositories/publication-model";

const outcomeColor: Record<PublicationOutcome, string> = {
  published: "text-status-published",
  skipped: "text-status-scheduled",
  empty_queue: "text-status-queued",
  generation_failed: "text-status-failed",
  validation_failed: "text-status-failed",
  api_failed: "text-status-failed",
  comment_failed: "text-status-queued",
};

export function HistoryTable({ initial }: { initial: Publication[] }) {
  const [filter, setFilter] = useState<PublicationOutcome | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(
    () => (filter === "all" ? initial : initial.filter((p) => p.outcome === filter)),
    [initial, filter],
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <FilterChip label="Tous" active={filter === "all"} onClick={() => setFilter("all")} />
        {PUBLICATION_OUTCOMES.map((o) => (
          <FilterChip key={o} label={o} active={filter === o} onClick={() => setFilter(o)} />
        ))}
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-fg-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Déclenché</th>
              <th className="px-3 py-2 text-left font-medium">Mode</th>
              <th className="px-3 py-2 text-left font-medium">Résultat</th>
              <th className="px-3 py-2 text-left font-medium">Status HTTP</th>
              <th className="px-3 py-2 text-left font-medium">Durée</th>
              <th className="px-3 py-2 text-left font-medium">Post</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-fg-muted">
                  Aucune publication enregistrée.
                </td>
              </tr>
            ) : (
              rows.map((p) => (
                <RowPair key={p._id} p={p} expanded={expanded === p._id} onToggle={() => setExpanded(expanded === p._id ? null : p._id)} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowPair({ p, expanded, onToggle }: { p: Publication; expanded: boolean; onToggle: () => void }) {
  return (
    <>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{p.triggeredAt.toString().slice(0, 24)}</td>
                    <td className="px-3 py-2">{p.mode}</td>
                    <td className={`px-3 py-2 font-medium ${outcomeColor[p.outcome]}`}>{p.outcome}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.linkedinStatus ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.durationMs} ms</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.postId?.slice(-6) ?? "—"}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={onToggle}
                        className="text-xs text-fg-muted underline hover:text-fg"
                      >
                        {expanded ? "fermer" : "détails"}
                      </button>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="bg-bg">
                      <td colSpan={7} className="px-3 py-3">
                        <Detail label="idempotencyKey" value={p.idempotencyKey} />
                        {p.error ? <Detail label="error" value={p.error} /> : null}
                        {p.linkedinResponse ? <Detail label="linkedinResponse" value={p.linkedinResponse} /> : null}
                        {p.payloadSnapshot ? (
                          <Detail
                            label="payloadSnapshot (dryRun)"
                            value={JSON.stringify(p.payloadSnapshot, null, 2)}
                          />
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
    </>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs ${
        active ? "border-accent bg-accent text-bg" : "border-border text-fg-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2">
      <div className="text-xs text-fg-muted">{label}</div>
      <pre className="mt-1 max-h-64 overflow-auto rounded bg-surface p-2 font-mono text-xs">{value}</pre>
    </div>
  );
}
