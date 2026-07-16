"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Tabs } from "@/modules/shared/ui/primitives";
import type { MailQueueStatus } from "@/modules/mailing/domain/mail-queue";

// Types sérialisés (les Date sont ISO en provenance du server component).
interface SerializableEntry {
  _id: string;
  companyId: string;
  kind: "sequence" | "campaign";
  sequenceStep: number | null;
  campaignId: string | null;
  priority: 1 | 2 | 3;
  subject: string;
  body: string;
  snapshot: { name: string; email: string; greeting: string };
  status: MailQueueStatus;
  attempts: number;
  lastError: string | null;
  cancelReason: string | null;
  createdAt: string;
  sentAt: string | null;
}

const STATUS_TABS: Array<{ value: MailQueueStatus; label: string }> = [
  { value: "pending", label: "En attente" },
  { value: "sending", label: "En cours" },
  { value: "sent", label: "Envoyés" },
  { value: "failed", label: "Échecs" },
  { value: "cancelled", label: "Annulés" },
];

const STATUS_TONE: Record<MailQueueStatus, "queued" | "scheduled" | "published" | "failed" | "draft"> = {
  pending: "queued",
  sending: "scheduled",
  sent: "published",
  failed: "failed",
  cancelled: "draft",
};

export function QueueClient({ entries }: { entries: SerializableEntry[] }) {
  const [tab, setTab] = useState<MailQueueStatus>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const router = useRouter();

  const counts = useMemo(() => {
    const c: Record<MailQueueStatus, number> = {
      pending: 0,
      sending: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const e of entries) c[e.status] = (c[e.status] ?? 0) + 1;
    return c;
  }, [entries]);

  const filtered = entries.filter((e) => e.status === tab);

  async function cancel(id: string) {
    if (!confirm("Annuler cette entrée ?")) return;
    setBusyId(id);
    try {
      const r = await fetch(`/api/mailing/queue/${id}/cancel`, { method: "POST" });
      if (!r.ok) alert("Annulation impossible");
      else router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function retry(id: string) {
    setBusyId(id);
    try {
      const r = await fetch(`/api/mailing/queue/${id}/retry`, { method: "POST" });
      if (!r.ok) alert("Ré-ouverture impossible");
      else router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <header>
        <h1 className="text-xl font-semibold">File d&apos;envoi</h1>
        <p className="text-sm text-fg-muted mt-1">
          Sujet et corps sont figés à l&apos;enfilement : ce qui est affiché est ce qui partira.
        </p>
      </header>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={STATUS_TABS.map((t) => ({ value: t.value, label: t.label, count: counts[t.value] }))}
      />

      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-fg-muted text-sm">Rien ici.</Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((e) => (
            <Card key={e._id} className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
                  <span className="text-xs font-mono text-fg-muted">p{e.priority}</span>
                  <span className="text-xs font-mono text-fg-muted">
                    {e.kind === "sequence" ? `step ${e.sequenceStep}` : "campaign"}
                  </span>
                  <span className="text-sm font-medium truncate">{e.snapshot.name}</span>
                  <span className="text-xs font-mono text-fg-muted truncate">
                    {e.snapshot.email}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {e.status === "pending" ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => cancel(e._id)}
                      disabled={busyId === e._id}
                    >
                      Annuler
                    </Button>
                  ) : null}
                  {e.status === "failed" ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => retry(e._id)}
                      disabled={busyId === e._id}
                    >
                      Réessayer
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="text-sm font-medium">{e.subject}</div>
              <pre className="text-xs whitespace-pre-wrap font-mono text-fg-muted max-h-32 overflow-y-auto border border-border rounded p-2 bg-surface">
                {e.body.slice(0, 800)}
                {e.body.length > 800 ? "…" : ""}
              </pre>
              {e.lastError ? (
                <div className="text-xs text-failed font-mono">{e.lastError}</div>
              ) : null}
              {e.cancelReason ? (
                <div className="text-xs text-fg-muted font-mono">annulé : {e.cancelReason}</div>
              ) : null}
              <div className="text-[11px] text-fg-muted font-mono">
                créé {new Date(e.createdAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
                {e.sentAt
                  ? ` · envoyé ${new Date(e.sentAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`
                  : ""}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
