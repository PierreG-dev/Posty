import Link from "next/link";
import { listThemes } from "@/modules/linkedin/repositories/theme-repo";
import { Button, Badge, EmptyState, Card } from "@/modules/shared/ui/primitives";
import { Plus, Pencil } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ThemesPage() {
  const themes = await listThemes({ includeArchived: true });

  return (
    <div className="p-8 max-w-5xl">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Thèmes</h1>
          <p className="text-sm text-fg-muted mt-1">
            Un thème définit une posture, un ton, des exemples. C'est le champ le plus déterminant de la qualité de génération.
          </p>
        </div>
        <Link href="/linkedin/themes/new">
          <Button variant="primary">
            <Plus size={16} strokeWidth={1.5} />
            Nouveau thème
          </Button>
        </Link>
      </header>

      {themes.length === 0 ? (
        <EmptyState
          title="Aucun thème."
          description="Crée un premier thème pour classer tes posts. Un thème par sujet éditorial."
          action={
            <Link href="/linkedin/themes/new">
              <Button variant="primary">Créer un thème</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {themes.map((t) => (
            <Card key={t._id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className="w-10 h-10 rounded-md shrink-0 flex items-center justify-center text-lg"
                    style={{ backgroundColor: t.color + "22", color: t.color, border: `1px solid ${t.color}55` }}
                  >
                    {t.emoji || "◆"}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-medium truncate">{t.name}</h3>
                      {!t.active ? <Badge tone="neutral">Archivé</Badge> : null}
                      {t.ai.examples.length === 0 ? (
                        <Badge tone="failed">Sans exemple</Badge>
                      ) : (
                        <Badge tone="neutral">{t.ai.examples.length} ex.</Badge>
                      )}
                    </div>
                    <p className="text-xs text-fg-muted mt-1 line-clamp-2">
                      {t.description || <span className="italic">Pas de description.</span>}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-fg-muted font-mono">
                      <span>slug: {t.slug}</span>
                      <span>·</span>
                      <span>visuel: {t.visual.mode}</span>
                      <span>·</span>
                      <span>{t.defaultHashtags.length} hashtag(s)</span>
                    </div>
                  </div>
                </div>
                <Link href={`/linkedin/themes/${t._id}`}>
                  <Button variant="ghost" size="sm">
                    <Pencil size={14} strokeWidth={1.5} />
                    Éditer
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
