"use client";

import * as React from "react";
import { Alert, Badge, Button, Card, Input } from "@/modules/shared/ui/primitives";
import type { TwentyCompany, CompanyStatus } from "@/modules/mailing/twenty";
import type { CompanyMeta } from "@/modules/mailing/domain/company-meta";

type Row = TwentyCompany & { meta: CompanyMeta | null };

export function ContactsList({ initial }: { initial: Row[] }) {
  const [rows, setRows] = React.useState<Row[]>(initial);
  const [statusFilter, setStatusFilter] = React.useState<CompanyStatus | "ALL">("ALL");
  const [q, setQ] = React.useState("");

  const visible = React.useMemo(() => {
    let list = rows;
    if (statusFilter !== "ALL") list = list.filter((r) => r.status === statusFilter);
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(needle));
    }
    return list;
  }, [rows, statusFilter, q]);

  async function saveGreeting(id: string, greeting: string) {
    const res = await fetch(`/api/mailing/contacts/${id}/greeting`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ greeting }),
    });
    if (res.ok) {
      const j = (await res.json()) as { meta: CompanyMeta };
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, meta: j.meta } : r)));
    }
  }

  async function regenerate(id: string) {
    const res = await fetch(`/api/mailing/contacts/${id}/greeting`, { method: "POST" });
    if (res.ok) {
      const j = (await res.json()) as { meta: CompanyMeta };
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, meta: j.meta } : r)));
    }
  }

  return (
    <div className="p-8 space-y-4 max-w-6xl">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Contacts (Twenty)</h1>
        <a
          href={typeof window !== "undefined" ? window.location.href : "#"}
          className="text-xs text-fg-muted hover:text-fg"
          onClick={(e) => { e.preventDefault(); location.reload(); }}
        >
          Recharger
        </a>
      </header>

      {rows.length === 0 ? (
        <Alert tone="info">
          Aucun contact — vérifie la connexion Twenty dans les réglages.
        </Alert>
      ) : null}

      <div className="flex items-center gap-3">
        <select
          className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as CompanyStatus | "ALL")}
        >
          <option value="ALL">Tous statuts</option>
          <option value="PROSPECT">PROSPECT</option>
          <option value="CLIENT">CLIENT</option>
          <option value="PARTENAIRE">PARTENAIRE</option>
        </select>
        <Input
          placeholder="Rechercher par nom…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <span className="text-xs text-fg-muted ml-auto">{visible.length} contacts</span>
      </div>

      <Card className="divide-y divide-border">
        {visible.map((r) => (
          <ContactRow key={r.id} row={r} onSave={saveGreeting} onRegenerate={regenerate} />
        ))}
      </Card>
    </div>
  );
}

function ContactRow({
  row,
  onSave,
  onRegenerate,
}: {
  row: Row;
  onSave: (id: string, greeting: string) => Promise<void>;
  onRegenerate: (id: string) => Promise<void>;
}) {
  const [greeting, setGreeting] = React.useState<string>(row.meta?.greeting ?? "");
  const [busy, setBusy] = React.useState(false);
  const dirty = greeting !== (row.meta?.greeting ?? "");

  return (
    <div className="p-4 flex items-start gap-4">
      <div className="w-64 min-w-0">
        <div className="text-sm font-medium truncate">{row.name}</div>
        <div className="text-xs font-mono text-fg-muted truncate">
          {row.contactEmail?.primaryEmail ?? <span className="italic">sans email</span>}
        </div>
        <div className="mt-1 flex items-center gap-1">
          {row.status ? <Badge tone="neutral">{row.status}</Badge> : null}
          <Badge tone={row.isAutoHandled ? "accent" : "draft"}>
            {row.isAutoHandled ? "auto" : "manuel"}
          </Badge>
          {row.followupCount > 0 ? <Badge tone="scheduled">step {row.followupCount}</Badge> : null}
          {row.meta?.paused ? <Badge tone="failed">paused</Badge> : null}
          {row.meta?.bounce ? <Badge tone="failed">{row.meta.bounce.kind} bounce</Badge> : null}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <Input
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          placeholder="Salutation (non générée)"
        />
        <div className="text-[10px] font-mono text-fg-muted mt-1">
          {row.meta?.greetingEditedByHuman ? "édité à la main" : row.meta?.greeting ? "généré" : "vide"}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !dirty || !greeting.trim()}
          onClick={async () => {
            setBusy(true);
            await onSave(row.id, greeting.trim());
            setBusy(false);
          }}
        >
          Enregistrer
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onRegenerate(row.id);
            setBusy(false);
          }}
        >
          Régénérer via IA
        </Button>
      </div>
    </div>
  );
}
