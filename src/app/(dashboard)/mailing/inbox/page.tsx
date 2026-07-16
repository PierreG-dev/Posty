import { DateTime } from "luxon";
import { Inbox } from "lucide-react";
import { PARIS } from "@/modules/shared/luxon";
import { Alert, Badge, Card } from "@/modules/shared/ui/primitives";
import { listMeta } from "@/modules/mailing/repositories/company-meta-repo";
import { twentyFromEnv } from "@/modules/mailing/twenty";
import { InboxRowActions } from "./InboxRowActions";

export const dynamic = "force-dynamic";

// §8.2 CDC-02 — les réponses (`paused: reply`) sont les SEULES choses qui
// demandent une action humaine. Une page dédiée avec deux boutons par ligne :
// « Passer en CLIENT » / « Reprendre la séquence ».
export default async function MailingInboxPage() {
  const [replies, hardBounces] = await Promise.all([
    listMeta({ paused: true, pausedReason: "reply" }),
    listMeta({ bounceKind: "hard" }),
  ]);

  const twenty = twentyFromEnv();
  const enriched = await Promise.all(
    replies.map(async (m) => {
      let name = m.companyId;
      if (twenty) {
        try {
          const c = await twenty.getCompany(m.companyId);
          if (c) name = c.name;
        } catch {
          // ignore
        }
      }
      return { ...m, name };
    }),
  );

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <header className="flex items-center gap-3">
        <Inbox size={22} strokeWidth={1.5} className="text-accent" />
        <h1 className="text-xl font-semibold">Boîte — Actions à traiter</h1>
      </header>

      {replies.length === 0 ? (
        <Alert tone="info">Aucune réponse en attente. Tout est calme.</Alert>
      ) : (
        <section className="space-y-3">
          <h2 className="text-sm font-mono uppercase tracking-wider text-fg-muted">
            💬 Réponses en attente ({replies.length})
          </h2>
          {enriched.map((m) => (
            <Card key={m.companyId} className="p-4 flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold">{m.name}</div>
                <div className="text-xs text-fg-muted font-mono">
                  {m.pausedAt
                    ? DateTime.fromJSDate(m.pausedAt).setZone(PARIS).toFormat("dd LLL HH:mm", { locale: "fr" })
                    : "—"}
                  {" · "}
                  {m.companyId}
                </div>
              </div>
              <InboxRowActions companyId={m.companyId} />
            </Card>
          ))}
        </section>
      )}

      {hardBounces.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-mono uppercase tracking-wider text-fg-muted">
            🚨 Hard bounces récents ({hardBounces.length})
          </h2>
          {hardBounces.slice(0, 20).map((m) => (
            <Card key={m.companyId} className="p-4 flex items-center justify-between gap-4">
              <div>
                <div className="font-mono text-sm">{m.companyId}</div>
                <div className="text-xs text-fg-muted">
                  {m.bounce?.lastCode ?? "—"} · {m.bounce?.lastAt
                    ? DateTime.fromJSDate(m.bounce.lastAt).setZone(PARIS).toFormat("dd LLL HH:mm", { locale: "fr" })
                    : "—"}
                </div>
              </div>
              <Badge tone="failed">isAutoHandled=false</Badge>
            </Card>
          ))}
        </section>
      ) : null}
    </div>
  );
}
