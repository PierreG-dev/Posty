import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { Badge, Button, Card } from "@/modules/shared/ui/primitives";
import { listCampaigns } from "@/modules/mailing/repositories/campaigns-repo";
import type { CampaignStatus } from "@/modules/mailing/domain/campaigns";

export const dynamic = "force-dynamic";

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

export default async function CampaignsPage() {
  const campaigns = await listCampaigns();
  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Megaphone size={22} strokeWidth={1.5} className="text-accent" />
          <h1 className="text-xl font-semibold">Campagnes</h1>
        </div>
        <Link href="/mailing/campaigns/new">
          <Button variant="primary">
            <Plus size={16} strokeWidth={1.5} />
            Nouvelle campagne
          </Button>
        </Link>
      </header>

      <p className="text-sm text-fg-muted max-w-2xl">
        Une campagne s&apos;écoule à travers la même file que la séquence
        automatique, en priorité 3 : elle passe DERRIÈRE les relances et les
        premiers contacts. Une campagne de 60 contacts met des semaines à
        partir — c&apos;est ce qui protège le domaine.
      </p>

      {campaigns.length === 0 ? (
        <Card className="p-8 text-center text-fg-muted">
          Aucune campagne pour l&apos;instant.
        </Card>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <Link key={c._id} href={`/mailing/campaigns/${c._id}`}>
              <Card className="p-4 hover:border-accent/40 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium truncate">{c.name}</span>
                      <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    </div>
                    <div className="text-sm text-fg-muted truncate">{c.subject}</div>
                  </div>
                  <div className="text-right font-mono text-xs text-fg-muted whitespace-nowrap">
                    {c.status === "draft" ? (
                      <>{c.targetCompanyIds.length} cible{c.targetCompanyIds.length > 1 ? "s" : ""}</>
                    ) : (
                      <>
                        {c.stats.sent}/{c.stats.total} envoyés
                        {c.stats.cancelled > 0 ? ` · ${c.stats.cancelled} annulés` : ""}
                        {c.stats.failed > 0 ? ` · ${c.stats.failed} échecs` : ""}
                      </>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
