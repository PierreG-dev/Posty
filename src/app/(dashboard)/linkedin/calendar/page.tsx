import { listSlots } from "@/modules/linkedin/repositories/slot-repo";
import { listThemes } from "@/modules/linkedin/repositories/theme-repo";
import { getSettings } from "@/modules/shared/settings/repo";
import { SlotsCalendar } from "@/modules/linkedin/ui/slots-calendar";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const [slots, themes, settings] = await Promise.all([
    listSlots(),
    listThemes(),
    getSettings(),
  ]);
  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Calendrier</h1>
        <p className="text-sm text-fg-muted mt-1">
          Créneaux récurrents (heure de Paris). Le badge indique le mode effectif :
          <span className="font-mono text-fg mx-1">File</span> tire le premier post en attente,
          <span className="font-mono text-fg mx-1">IA</span> génère à la volée.
        </p>
      </header>
      <SlotsCalendar
        initialSlots={slots}
        themes={themes.map((t) => ({ _id: t._id, name: t.name, color: t.color, emoji: t.emoji }))}
        autoGeneration={settings.autoGeneration}
      />
    </div>
  );
}
