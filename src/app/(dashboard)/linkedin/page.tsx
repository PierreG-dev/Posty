import Link from "next/link";
import { Card, Badge, Alert } from "@/modules/shared/ui/primitives";
import { getLinkedInStatus, getSettings } from "@/modules/shared/settings/repo";
import { listThemes } from "@/modules/linkedin/repositories/theme-repo";
import { countQueuedByTheme } from "@/modules/linkedin/repositories/post-repo";
import { listPublications } from "@/modules/linkedin/repositories/publication-repo";
import { projectUpcoming } from "@/modules/linkedin/services/upcoming";
import { AutoSwitch } from "@/modules/linkedin/ui/auto-switch";
import { Countdown } from "@/modules/linkedin/ui/countdown";
import { AlertTriangle, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LinkedInDashboardPage() {
  const [status, settings, themes, byTheme, upcoming, recent] = await Promise.all([
    getLinkedInStatus(),
    getSettings(),
    listThemes(),
    countQueuedByTheme(),
    projectUpcoming(5),
    listPublications({ limit: 3 }),
  ]);

  const next = upcoming[0];
  const totalQueued = Object.values(byTheme).reduce((a, b) => a + b, 0);
  const daysUntilRefresh = status.refreshExpiresAt
    ? Math.max(0, Math.round((status.refreshExpiresAt.getTime() - Date.now()) / 86400000))
    : null;

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <header className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">LinkedIn</h1>
          <p className="text-sm text-fg-muted mt-1">
            {settings.dryRun ? "Mode dryRun — rien ne part vraiment." : "Publication réelle activée."}
          </p>
        </div>
        <AutoSwitch initial={settings.autoGeneration} />
      </header>

      {settings.dryRun ? (
        <Alert tone="warning">
          <strong>Mode dryRun actif.</strong> Toutes les publications sont simulées et archivées, aucun appel LinkedIn.
        </Alert>
      ) : null}

      {!status.connected ? (
        <Alert tone="danger">
          Compte LinkedIn non connecté. <Link href="/settings" className="underline">Ouvrir les réglages</Link>.
        </Alert>
      ) : daysUntilRefresh !== null && daysUntilRefresh < 14 ? (
        <Alert tone="warning">
          Le refresh token expire dans {daysUntilRefresh} jour(s). <Link href="/settings" className="underline">Reconnecter</Link>.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-fg-muted font-mono">Prochain créneau</div>
          {next ? (
            <div className="mt-2">
              <Countdown targetIso={next.scheduledAt} />
              <div className="text-sm text-fg mt-2">
                {next.themeName} <span className="text-fg-muted">·</span>{" "}
                <Badge tone={next.mode === "auto" ? "scheduled" : "queued"}>
                  {next.mode === "auto" ? "IA" : "File"}
                </Badge>
              </div>
              <div className="text-xs text-fg-muted font-mono mt-1">
                {next.scheduledAtParis} (heure de Paris)
              </div>
            </div>
          ) : (
            <div className="mt-2 text-sm text-fg-muted">Aucun créneau actif.</div>
          )}
        </Card>

        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-fg-muted font-mono">File totale</div>
          <div className="mt-2 text-3xl font-semibold font-mono">{totalQueued}</div>
          <div className="text-xs text-fg-muted mt-1">
            {settings.minQueueAlert
              ? `Alerte sous ${settings.minQueueAlert} post(s)`
              : "Pas d'alerte configurée"}
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-fg-muted font-mono">Connexion LinkedIn</div>
          {status.connected ? (
            <>
              <div className="mt-2 text-sm">
                <Badge tone="published">Connectée</Badge>
              </div>
              <div className="text-xs text-fg-muted mt-2 font-mono truncate">{status.authorUrn}</div>
            </>
          ) : (
            <div className="mt-2 text-sm">
              <Badge tone="failed">Déconnectée</Badge>
            </div>
          )}
        </Card>
      </div>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-fg-muted font-mono mb-3">
          File par thème
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {themes.map((t) => {
            const n = byTheme[t._id] ?? 0;
            const low = n < settings.minQueueAlert;
            return (
              <Card key={t._id} className={`p-3 ${low ? "border-status-failed/40" : ""}`}>
                <div className="flex items-center gap-2">
                  <span className="text-lg" style={{ color: t.color }}>{t.emoji || "◆"}</span>
                  <span className="text-sm truncate">{t.name}</span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-mono">{n}</span>
                  {low ? <AlertTriangle size={14} strokeWidth={1.5} className="text-status-failed" /> : null}
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-fg-muted font-mono mb-3">
          5 prochaines publications
        </h2>
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-fg-muted font-mono bg-surface-2">
              <tr>
                <th className="text-left px-3 py-2">Quand</th>
                <th className="text-left px-3 py-2">Thème</th>
                <th className="text-left px-3 py-2">Mode</th>
                <th className="text-left px-3 py-2">Ce qui partira</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-fg-muted text-sm">
                    Aucun créneau actif. <Link href="/linkedin/calendar" className="underline">En créer un</Link>.
                  </td>
                </tr>
              ) : (
                upcoming.map((u) => (
                  <tr key={u.slotId + u.scheduledAtParis} className="border-t border-border/60">
                    <td className="px-3 py-2 font-mono text-xs">{u.scheduledAtParis}</td>
                    <td className="px-3 py-2">
                      <span style={{ color: u.themeColor }}>◆</span> {u.themeName}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={u.mode === "auto" ? "scheduled" : "queued"}>
                        {u.mode === "auto" ? "IA" : "File"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {u.mode === "auto" ? (
                        <span className="text-fg-muted text-xs italic">généré à la volée</span>
                      ) : u.post ? (
                        <Link href={`/linkedin/posts/${u.post.id}`} className="hover:underline">
                          {u.post.content.slice(0, 60)}
                          {u.post.content.length > 60 ? "…" : ""}
                        </Link>
                      ) : (
                        <span className="text-status-failed">⚠️ file vide</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-fg-muted font-mono mb-3">
          3 dernières publications
        </h2>
        {recent.length === 0 ? (
          <Card className="p-4 text-sm text-fg-muted">Rien encore.</Card>
        ) : (
          <div className="space-y-2">
            {recent.map((p) => (
              <Card key={p._id} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-mono text-fg-muted">{p.triggeredAt.toISOString().slice(0, 16).replace("T", " ")}</div>
                  <div className="text-sm">
                    <Badge tone={p.outcome === "published" ? "published" : p.outcome === "skipped" ? "neutral" : "failed"}>
                      {p.outcome}
                    </Badge>
                    <span className="text-fg-muted ml-2">{p.mode}</span>
                  </div>
                </div>
                {p.postId ? (
                  <Link href={`/linkedin/posts/${p.postId}`} className="text-xs text-fg-muted hover:text-fg flex items-center gap-1">
                    <ExternalLink size={12} strokeWidth={1.5} />
                    voir
                  </Link>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
