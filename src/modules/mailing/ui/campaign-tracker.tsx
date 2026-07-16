"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Alert, Badge, Button, Card } from "@/modules/shared/ui/primitives";
import type { CampaignStatus, CampaignStats } from "@/modules/mailing/domain/campaigns";

interface Props {
  campaign: {
    _id: string;
    name: string;
    subject: string;
    status: CampaignStatus;
    stats: CampaignStats;
    queuedAt: string | null;
    completedAt: string | null;
    targetCount: number;
  };
}

const STATUS_TONE: Record<CampaignStatus, "draft" | "queued" | "scheduled" | "published" | "failed"> = {
  draft: "draft",
  queued: "queued",
  sending: "scheduled",
  done: "published",
  cancelled: "failed",
};

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "brouillon",
  queued: "en file",
  sending: "en cours",
  done: "terminée",
  cancelled: "annulée",
};

export function CampaignTracker({ campaign }: Props) {
  const router = useRouter();
  const [cancelling, setCancelling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canCancel = campaign.status === "queued" || campaign.status === "sending";

  async function doCancel() {
    if (!confirm("Annuler les envois restants ? Les mails déjà partis ne peuvent pas être rappelés."))
      return;
    setCancelling(true);
    setError(null);
    try {
      const r = await fetch(`/api/mailing/campaigns/${campaign._id}/cancel`, {
        method: "POST",
      });
      if (!r.ok) {
        const data = await r.json().catch(() => null);
        setError(`Annulation refusée : ${data?.error ?? r.status}`);
        return;
      }
      router.refresh();
    } finally {
      setCancelling(false);
    }
  }

  const { stats } = campaign;
  const remaining = stats.enqueued;
  const progress = stats.total > 0 ? Math.round((stats.sent / stats.total) * 100) : 0;

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-semibold">{campaign.name}</h1>
            <Badge tone={STATUS_TONE[campaign.status]}>{STATUS_LABEL[campaign.status]}</Badge>
          </div>
          <p className="text-sm text-fg-muted">Sujet : {campaign.subject}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/mailing/campaigns">
            <Button variant="ghost">Retour</Button>
          </Link>
          {canCancel ? (
            <Button variant="danger" onClick={doCancel} disabled={cancelling}>
              {cancelling ? "Annulation…" : "Annuler les envois restants"}
            </Button>
          ) : null}
        </div>
      </header>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between text-sm">
          <div>
            <span className="font-mono text-2xl">{stats.sent}</span>
            <span className="text-fg-muted ml-2">/ {stats.total} envoyés</span>
          </div>
          <div className="text-fg-muted font-mono text-sm">{progress}%</div>
        </div>
        <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <StatCell label="En file" value={remaining} />
          <StatCell label="Envoyés" value={stats.sent} />
          <StatCell label="Annulés" value={stats.cancelled} tone={stats.cancelled > 0 ? "muted" : undefined} />
          <StatCell label="Échecs" value={stats.failed} tone={stats.failed > 0 ? "failed" : undefined} />
        </div>
      </Card>

      <Card className="p-5 space-y-2 text-sm text-fg-muted">
        <div>Cibles sélectionnées : <span className="font-mono">{campaign.targetCount}</span></div>
        <div>
          Mise en file :{" "}
          <span className="font-mono">
            {campaign.queuedAt ? new Date(campaign.queuedAt).toLocaleString("fr-FR") : "—"}
          </span>
        </div>
        {campaign.completedAt ? (
          <div>
            Terminée :{" "}
            <span className="font-mono">
              {new Date(campaign.completedAt).toLocaleString("fr-FR")}
            </span>
          </div>
        ) : null}
        <div className="pt-2">
          <Link href="/mailing/queue?kind=campaign" className="text-accent hover:underline">
            Voir les entrées dans la file →
          </Link>
        </div>
      </Card>
    </div>
  );
}

function StatCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "muted" | "failed";
}) {
  const cls = tone === "failed" ? "text-failed" : tone === "muted" ? "text-fg-muted" : "text-fg";
  return (
    <div>
      <div className="text-xs font-mono uppercase tracking-wider text-fg-muted">{label}</div>
      <div className={`text-lg font-mono ${cls}`}>{value}</div>
    </div>
  );
}
