import { DateTime } from "luxon";
import { PARIS } from "@/modules/shared/luxon";
import { getSettings } from "@/modules/shared/settings/repo";
import { listSlots } from "@/modules/linkedin/repositories/slot-repo";
import { peekQueuedHead } from "@/modules/linkedin/repositories/post-repo";
import { listThemes } from "@/modules/linkedin/repositories/theme-repo";
import type { Slot } from "@/modules/linkedin/domain/slot";
import type { Post } from "@/modules/linkedin/domain/post";
import type { PublicationMode } from "@/modules/linkedin/repositories/publication-model";

export interface UpcomingItem {
  slotId: string;
  slotLabel: string;
  scheduledAt: string; // ISO, UTC — l'UI reconverti en Paris.
  scheduledAtParis: string; // "yyyy-LL-dd HH:mm"
  themeId: string;
  themeName: string;
  themeColor: string;
  mode: PublicationMode; // effectif après modeOverride
  post: { id: string; content: string } | null; // null si file vide / mode auto
}

/**
 * §12 dashboard — projection des N prochaines exécutions. On parcourt jour
 * après jour à partir de `now` (Paris) et on retient les slots actifs dont
 * `dayOfWeek`/`time` tombent dans le futur (ou dans la fenêtre de rattrapage
 * si on est le même jour). En mode `queue`, on "consomme" la file en mémoire
 * pour projeter fidèlement quel post partira où.
 */
export async function projectUpcoming(n: number, now: Date = new Date()): Promise<UpcomingItem[]> {
  if (n <= 0) return [];
  const [slots, settings, themes] = await Promise.all([
    listSlots({ activeOnly: true }),
    getSettings(),
    listThemes(),
  ]);
  const themeById = new Map(themes.map((t) => [t._id, t]));

  const nowParis = DateTime.fromJSDate(now).setZone(PARIS);
  const items: UpcomingItem[] = [];

  // Pour projeter le "quel post" en mode queue, on tire une tête par thème
  // à la volée, mais on doit compter les "consommations" par thème pour ne
  // pas afficher le même post sur deux créneaux du même thème.
  const consumed = new Map<string, number>();

  // On regarde 6 semaines devant (largement suffisant pour n ≤ 20).
  for (let dayOffset = 0; dayOffset < 42 && items.length < n; dayOffset += 1) {
    const day = nowParis.plus({ days: dayOffset }).startOf("day");
    const dow = day.weekday; // 1..7
    const slotsOfDay = slots
      .filter((s) => s.dayOfWeek === dow)
      .sort((a, b) => a.time.localeCompare(b.time));
    for (const s of slotsOfDay) {
      if (items.length >= n) break;
      const [hh, mm] = s.time.split(":").map((x) => Number(x));
      const at = day.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
      // On garde le créneau si futur, ou si dans la fenêtre de rattrapage.
      if (at < nowParis && nowParis.diff(at, "minutes").minutes > 15) continue;

      const mode: PublicationMode = s.modeOverride ?? (settings.autoGeneration ? "auto" : "queue");
      const theme = themeById.get(s.themeId);
      let post: UpcomingItem["post"] = null;
      if (mode === "queue") {
        const already = consumed.get(s.themeId) ?? 0;
        // Projection légère : on n'affiche le "vrai" post que pour le tout
        // premier créneau du thème (on n'a pas de vue paginée par thème ici).
        if (already === 0) {
          const head = await peekQueuedHead(s.themeId);
          if (head) post = { id: head._id, content: head.content };
        }
        consumed.set(s.themeId, already + 1);
      }
      items.push({
        slotId: s._id,
        slotLabel: s.label,
        scheduledAt: at.toUTC().toISO() ?? "",
        scheduledAtParis: at.toFormat("yyyy-LL-dd HH:mm"),
        themeId: s.themeId,
        themeName: theme?.name ?? "(thème supprimé)",
        themeColor: theme?.color ?? "#FFB020",
        mode,
        post,
      });
    }
  }

  return items;
}

export type { Slot, Post };
