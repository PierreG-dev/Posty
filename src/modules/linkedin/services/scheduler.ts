import { DateTime } from "luxon";
import { PARIS, toParis } from "@/modules/shared/luxon";
import type { Slot } from "@/modules/linkedin/domain/slot";
import type { Post } from "@/modules/linkedin/domain/post";

/** Fenêtre de rattrapage (§7.1) : un créneau manqué depuis moins de N min
 * est rattrapé. Au-delà : `skipped`. Vaut aussi pour les one-shots. */
export const CATCHUP_WINDOW_MIN = 15;

export interface DueSlot {
  slot: Slot;
  /** Instant Paris (yyyy-MM-dd HH:mm) — utilisé pour l'idempotencyKey. */
  scheduledAtParis: DateTime;
}

/**
 * PURE. Étant donné une liste de slots et l'instant courant, renvoie ceux
 * qui doivent tirer maintenant : leur `dayOfWeek`/`time` en Paris est
 * ≤ now, et now est dans la fenêtre [scheduled, scheduled + CATCHUP_WINDOW_MIN].
 * `active === false` → jamais retourné.
 */
export function computeDueSlots(slots: Slot[], now: Date): DueSlot[] {
  const nowParis = toParis(now);
  const today = nowParis.startOf("day");
  const due: DueSlot[] = [];
  for (const slot of slots) {
    if (!slot.active) continue;
    if (slot.dayOfWeek !== nowParis.weekday) continue;
    const [hh, mm] = slot.time.split(":").map((s) => Number(s));
    const scheduled = today.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
    const diffMin = nowParis.diff(scheduled, "minutes").minutes;
    if (diffMin < 0) continue;
    if (diffMin > CATCHUP_WINDOW_MIN) continue;
    due.push({ slot, scheduledAtParis: scheduled });
  }
  return due;
}

export interface DueOneShot {
  post: Post;
  /** `true` si `now - scheduledAt > CATCHUP_WINDOW_MIN` (à `skipped`). */
  missed: boolean;
}

/**
 * PURE. One-shots dus. Renvoie deux catégories via `missed` :
 * - `missed=false` : à publier maintenant.
 * - `missed=true` : à marquer `skipped` (créneau manqué de trop longtemps).
 */
export function computeDueOneShots(posts: Post[], now: Date): DueOneShot[] {
  const out: DueOneShot[] = [];
  for (const p of posts) {
    if (p.status !== "scheduled" || !p.scheduledAt) continue;
    const diffMin = (now.getTime() - p.scheduledAt.getTime()) / 60_000;
    if (diffMin < 0) continue;
    out.push({ post: p, missed: diffMin > CATCHUP_WINDOW_MIN });
  }
  return out;
}

/** Clé d'idempotence d'un tir de créneau (§5). Format stable, ancré Paris. */
export function slotIdempotencyKey(slotId: string, scheduledAtParis: DateTime): string {
  return `${slotId}-${scheduledAtParis.setZone(PARIS).toFormat("yyyy-LL-dd-HH:mm")}`;
}

/** Clé d'idempotence pour un one-shot (§5). */
export function oneShotIdempotencyKey(postId: string): string {
  return `oneshot-${postId}`;
}

/** Verrou par slot/jour (§5). Un seul tir par slot par journée Paris. */
export function slotLockKey(slotId: string, at: DateTime): string {
  return `publish:${slotId}:${at.setZone(PARIS).toFormat("yyyy-LL-dd")}`;
}
