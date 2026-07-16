import Link from "next/link";
import { getSettings, getLinkedInStatus } from "@/modules/shared/settings/repo";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ linkedin?: string }>;
}) {
  const [s, ls, sp] = await Promise.all([getSettings(), getLinkedInStatus(), searchParams]);
  const oauthMsg =
    sp.linkedin === "ok"
      ? { level: "ok" as const, text: "LinkedIn connecté." }
      : sp.linkedin === "error"
        ? { level: "err" as const, text: "Échec de la connexion LinkedIn." }
        : null;

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-semibold">Réglages</h1>
      <p className="mt-1 text-sm text-fg-muted">Section LinkedIn ajoutée au lot 3.</p>

      {oauthMsg ? (
        <div
          className={`mt-4 rounded border px-3 py-2 text-sm ${
            oauthMsg.level === "ok"
              ? "border-status-published/60 text-status-published"
              : "border-status-failed/60 text-status-failed"
          }`}
        >
          {oauthMsg.text}
        </div>
      ) : null}

      <section className="mt-6 rounded-lg border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-medium">LinkedIn</h2>
          <Link
            href="/api/linkedin/auth"
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
            prefetch={false}
          >
            {ls.connected ? "Reconnecter" : "Connecter"}
          </Link>
        </div>
        <div className="space-y-2">
          <Row label="État" value={ls.connected ? "connecté" : "non connecté"} />
          <Row label="URN auteur" value={ls.authorUrn ?? "—"} />
          <Row
            label="Access token expire"
            value={ls.expiresAt ? ls.expiresAt.toISOString() : "—"}
          />
          <Row
            label="Refresh token expire"
            value={ls.refreshExpiresAt ? ls.refreshExpiresAt.toISOString() : "—"}
          />
          <Row label="Mode dryRun" value={String(ls.dryRun)} />
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="mb-3 text-base font-medium">Général</h2>
        <div className="space-y-2">
          <Row label="Auto-génération LinkedIn" value={String(s.autoGeneration)} />
          <Row label="Fuseau" value={s.timezone} />
          <Row label="Seuil d'alerte file" value={String(s.minQueueAlert)} />
          <Row label="Pushover" value={s.pushover.enabled ? "activé" : "inactif"} />
          <Row label="Modèle IA" value={s.ai.model} />
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 pb-2 last:border-none">
      <span className="text-sm text-fg-muted">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}
