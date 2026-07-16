import { DateTime } from "luxon";
import { Mail } from "lucide-react";
import Link from "next/link";
import { Alert, Badge, Card } from "@/modules/shared/ui/primitives";
import { PARIS } from "@/modules/shared/luxon";
import { getMailSettings } from "@/modules/mailing/repositories/mail-settings-repo";
import { countPendingBreakdown } from "@/modules/mailing/repositories/mail-queue-repo";
import { countBreakdownOnParisDay } from "@/modules/mailing/repositories/mail-log-repo";
import { listMeta } from "@/modules/mailing/repositories/company-meta-repo";

export const dynamic = "force-dynamic";

const DOW_LABELS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;

export default async function MailingDashboardPage() {
  const settings = await getMailSettings();
  const now = new Date();
  const [sentToday, pending, replies, hardBounces] = await Promise.all([
    countBreakdownOnParisDay(now),
    countPendingBreakdown(),
    listMeta({ paused: true, pausedReason: "reply" }),
    listMeta({ bounceKind: "hard" }),
  ]);

  const jours = settings.sendDays
    .map((d) => `${DOW_LABELS[d.dayOfWeek - 1] ?? "?"} ${d.time}`)
    .join(" · ");

  const nextSlot = computeNextSlot(settings.sendDays, now);

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <header className="flex items-center gap-3">
        <Mail size={22} strokeWidth={1.5} className="text-accent" />
        <h1 className="text-xl font-semibold">Mailing — Prospection</h1>
        {settings.dryRun ? <Badge tone="queued">dryRun</Badge> : null}
        {settings.paused ? <Badge tone="failed">paused</Badge> : null}
      </header>

      {settings.paused ? (
        <Alert tone="warning">
          Arrêt d&apos;urgence : la boucle d&apos;envoi ne tourne pas tant que <code>paused</code> est <code>true</code>.
        </Alert>
      ) : null}

      {/* §11 CDC-02 — les alertes qui demandent une action humaine sont EN
          TÊTE. Réponses = décision à prendre. Bounces récents = à surveiller. */}
      {replies.length > 0 || hardBounces.length > 0 ? (
        <Alert tone={replies.length > 0 ? "warning" : "info"}>
          <div className="flex flex-wrap items-center gap-4">
            {replies.length > 0 ? (
              <Link href="/mailing/inbox" className="hover:underline">
                💬 <b>{replies.length}</b> réponse{replies.length > 1 ? "s" : ""} à traiter
              </Link>
            ) : null}
            {hardBounces.length > 0 ? (
              <Link href="/mailing/inbox" className="hover:underline">
                🚨 <b>{hardBounces.length}</b> hard bounce{hardBounces.length > 1 ? "s" : ""}
              </Link>
            ) : null}
          </div>
        </Alert>
      ) : null}

      {/* Bloc quota — la conséquence assumée du choix de priorité doit être
          visible (§plan). */}
      <Card className="p-5 space-y-3">
        <div className="text-xs font-mono uppercase tracking-wider text-fg-muted">
          Quota du jour
        </div>
        <div className="font-mono text-2xl">
          {sentToday.total}/{settings.dailyCap}
          <span className="text-fg-muted text-sm ml-2">
            · {sentToday.byPriority.p1} relances · {sentToday.byPriority.p2} premiers · {sentToday.byPriority.p3} campagnes
          </span>
        </div>
        <div className="text-sm text-fg-muted">
          {pending.total} en attente
          <span className="ml-2 font-mono">
            (p1 {pending.byPriority.p1} · p2 {pending.byPriority.p2} · p3 {pending.byPriority.p3})
          </span>
        </div>
        <div className="text-sm text-fg-muted">
          Prochain créneau :{" "}
          <span className="font-mono">
            {nextSlot
              ? nextSlot.setZone(PARIS).toFormat("EEE dd LLL HH:mm 'Paris'", { locale: "fr" })
              : "—"}
          </span>
        </div>
        <div>
          <Link href="/mailing/queue" className="text-accent text-sm hover:underline">
            Voir la file →
          </Link>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs font-mono uppercase tracking-wider text-fg-muted mb-2">
            Créneaux
          </div>
          <div className="font-mono text-sm">{jours}</div>
          <div className="text-xs text-fg-muted mt-2">Plafond : {settings.dailyCap}/jour</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-mono uppercase tracking-wider text-fg-muted mb-2">
            Séquence
          </div>
          <div className="font-mono text-sm">+{settings.sequence.delays.join("j / +")}j</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-mono uppercase tracking-wider text-fg-muted mb-2">Jitter</div>
          <div className="font-mono text-sm">
            {settings.jitter.minSeconds}–{settings.jitter.maxSeconds}s
          </div>
        </Card>
      </div>
    </div>
  );
}

function computeNextSlot(
  sendDays: { dayOfWeek: number; time: string }[],
  now: Date,
): DateTime | null {
  const nowP = DateTime.fromJSDate(now).setZone(PARIS);
  let best: DateTime | null = null;
  for (let offset = 0; offset < 8; offset++) {
    const day = nowP.plus({ days: offset });
    for (const s of sendDays) {
      if (s.dayOfWeek !== day.weekday) continue;
      const [hStr, mStr] = s.time.split(":");
      const candidate = day.set({
        hour: Number(hStr),
        minute: Number(mStr),
        second: 0,
        millisecond: 0,
      });
      if (candidate <= nowP) continue;
      if (!best || candidate < best) best = candidate;
    }
    if (best) break;
  }
  return best;
}
