import { logger } from "@/modules/shared/logger";
import { withLock } from "@/modules/shared/locks/lock";
import { notify } from "@/modules/shared/pushover/notify";
import { getSettings } from "@/modules/shared/settings/repo";
import { listSlots, getSlot } from "@/modules/linkedin/repositories/slot-repo";
import {
  applyPublishOutcome,
  listScheduledDue,
  peekQueuedHead,
} from "@/modules/linkedin/repositories/post-repo";
import { createPublication } from "@/modules/linkedin/repositories/publication-repo";
import { getTheme } from "@/modules/linkedin/repositories/theme-repo";
import { publishPost, type PublishResult } from "./publisher";
import { generatePost } from "./generator";
import {
  CATCHUP_WINDOW_MIN,
  computeDueOneShots,
  computeDueSlots,
  oneShotIdempotencyKey,
  slotIdempotencyKey,
  slotLockKey,
  type DueSlot,
} from "./scheduler";
import type { Slot } from "@/modules/linkedin/domain/slot";
import type { PublicationMode } from "@/modules/linkedin/repositories/publication-model";

// Verrou par slot : 5 min. Bien plus long qu'une publication normale, mais
// libéré automatiquement via l'index TTL en cas de crash.
const SLOT_LOCK_TTL_S = 5 * 60;

export interface ResolveOutcome {
  mode: PublicationMode;
  action:
    | { kind: "published"; result: PublishResult }
    | { kind: "empty_queue" }
    | { kind: "generation_failed"; error: string }
    | { kind: "validation_failed"; errors: string[] }
    | { kind: "duplicate" };
}

/** §7.2 — sélectionne le post à publier pour un slot donné, et publie. */
export async function resolvePublication(due: DueSlot): Promise<ResolveOutcome> {
  const { slot, scheduledAtParis } = due;
  const settings = await getSettings();
  const mode: PublicationMode =
    slot.modeOverride ?? (settings.autoGeneration ? "auto" : "queue");
  const idempotencyKey = slotIdempotencyKey(slot._id, scheduledAtParis);

  if (mode === "auto") {
    // §7.2 mode auto : la file N'EST PAS consommée. Elle reste intacte, en
    // réserve. On génère à la volée via Claude.
    const themeName = (await getTheme(slot.themeId))?.name ?? slot.themeId;
    let gen;
    try {
      gen = await generatePost(slot.themeId, { variants: 1, persist: true });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("linkedin.scheduler.generation_failed", {
        slotId: slot._id,
        themeId: slot.themeId,
        error: errorMsg,
      });
      const res = await createPublication({
        idempotencyKey,
        slotId: slot._id,
        mode: "auto",
        outcome: "generation_failed",
        error: errorMsg,
      });
      if (res.duplicate) return { mode, action: { kind: "duplicate" } };
      await notify(
        "Posty",
        `🚨 Génération échouée — ${themeName} — ${errorMsg.slice(0, 120)}`,
        1,
        `/linkedin/themes`,
      );
      return { mode, action: { kind: "generation_failed", error: errorMsg } };
    }

    const successful = gen.createdPosts[0];
    if (!successful) {
      // Toutes les variantes ont échoué la validation.
      const firstFailure = gen.variants.find((v) => !v.ok);
      const errors =
        firstFailure && !firstFailure.ok
          ? firstFailure.errors.map((e) => `${e.path}: ${e.message}`)
          : ["Aucune variante valide"];
      logger.warn("linkedin.scheduler.validation_failed", {
        slotId: slot._id,
        themeId: slot.themeId,
        errors,
      });
      const res = await createPublication({
        idempotencyKey,
        slotId: slot._id,
        mode: "auto",
        outcome: "validation_failed",
        error: errors.join(" | ").slice(0, 500),
      });
      if (res.duplicate) return { mode, action: { kind: "duplicate" } };
      await notify(
        "Posty",
        `🚨 Génération invalide — ${themeName} — ${errors[0]?.slice(0, 120) ?? "?"}`,
        1,
        `/linkedin/history`,
      );
      return { mode, action: { kind: "validation_failed", errors } };
    }

    // Succès : on publie le post fraîchement créé sous la même idempotencyKey.
    // La file reste intacte : `successful` a été créé en 'queued' par le
    // générateur, mais publishPost va le passer directement en 'publishing'
    // puis 'published', il ne fait donc PAS partie de la « file » du sens
    // §7.2 (peekQueuedHead n'est jamais appelé en mode auto).
    const result = await publishPost(successful._id, {
      mode: "auto",
      slotId: slot._id,
      idempotencyKey,
    });
    return { mode, action: { kind: "published", result } };
  }

  // Mode queue : tête de file pour le thème du slot.
  const head = await peekQueuedHead(slot.themeId);
  if (!head) {
    const themeName = (await getTheme(slot.themeId))?.name ?? slot.themeId;
    logger.warn("linkedin.scheduler.empty_queue", {
      slotId: slot._id,
      themeId: slot.themeId,
      scheduledAt: scheduledAtParis.toISO(),
    });
    const res = await createPublication({
      idempotencyKey,
      slotId: slot._id,
      mode: "queue",
      outcome: "empty_queue",
    });
    if (res.duplicate) return { mode, action: { kind: "duplicate" } };
    await notify(
      "Posty",
      `🚨 File vide — ${themeName} — créneau ${slot.time} raté`,
      1,
      `/linkedin/posts?status=queued&themeId=${slot.themeId}`,
    );
    return { mode, action: { kind: "empty_queue" } };
  }

  // On a un post : on publie. L'idempotencyKey est celle du slot, pas celle du
  // post — deux ticks concurrents pour le même slot/jour ne peuvent pas
  // publier deux posts différents.
  const result = await publishPost(head._id, {
    mode: "queue",
    slotId: slot._id,
    idempotencyKey,
  });
  return { mode, action: { kind: "published", result } };
}

/** Traite un slot dû sous verrou par-slot-par-jour. */
async function processDueSlot(due: DueSlot): Promise<void> {
  const key = slotLockKey(due.slot._id, due.scheduledAtParis);
  const outcome = await withLock(key, SLOT_LOCK_TTL_S, async () => {
    return resolvePublication(due);
  });
  if (outcome === null) {
    logger.debug("linkedin.scheduler.slot_locked", { slotId: due.slot._id });
  }
}

/** Traite un one-shot manqué : status=failed logique light + publication `skipped`. */
async function processMissedOneShot(postId: string, scheduledAt: Date | null): Promise<void> {
  const key = oneShotIdempotencyKey(postId);
  const res = await createPublication({
    idempotencyKey: key,
    postId,
    mode: "scheduled",
    outcome: "skipped",
    error: `one-shot manqué de plus de ${CATCHUP_WINDOW_MIN} min`,
  });
  if (res.duplicate) return;
  // On repasse le post en `failed` avec un message clair — l'UI proposera
  // « replanifier ». On ne perd pas le contenu.
  await applyPublishOutcome(postId, {
    status: "failed",
    lastError: `Créneau one-shot manqué (${scheduledAt?.toISOString() ?? "?"})`,
    incrementAttempts: false,
  });
  await notify(
    "Posty",
    `⚠️ Post programmé raté — replanifier`,
    0,
    `/linkedin/posts/${postId}`,
  );
}

async function processDueOneShot(postId: string): Promise<void> {
  const key = oneShotIdempotencyKey(postId);
  await publishPost(postId, {
    mode: "scheduled",
    idempotencyKey: key,
  });
}

/**
 * §7.1 — Un tick de scheduler.
 *  1. Lit les slots actifs et les one-shots dus.
 *  2. Pour chaque slot dû : `resolvePublication` sous verrou par-slot-par-jour.
 *  3. Pour chaque one-shot dû : publication idempotente ; s'il est manqué de
 *     plus de la fenêtre, on marque `failed` et on notifie.
 *
 * NB : le verrou GLOBAL du tick (55 s) vit dans worker/index.ts. Ici, le
 * verrou est par-slot, ce qui autorise le parallélisme entre slots simultanés
 * tout en garantissant l'unicité par slot/jour.
 */
export async function runSchedulerTick(now: Date = new Date()): Promise<{
  dueSlots: number;
  dueOneShots: number;
  missed: number;
}> {
  const [slots, scheduled] = await Promise.all([
    listSlots({ activeOnly: true }),
    listScheduledDue(now),
  ]);
  const dueSlots = computeDueSlots(slots, now);
  const dueOneShots = computeDueOneShots(scheduled, now);

  for (const d of dueSlots) {
    try {
      await processDueSlot(d);
    } catch (err) {
      logger.error("linkedin.scheduler.slot_error", { slotId: d.slot._id, err: String(err) });
    }
  }

  let missed = 0;
  for (const o of dueOneShots) {
    try {
      if (o.missed) {
        missed += 1;
        await processMissedOneShot(o.post._id, o.post.scheduledAt);
      } else {
        await processDueOneShot(o.post._id);
      }
    } catch (err) {
      logger.error("linkedin.scheduler.oneshot_error", { postId: o.post._id, err: String(err) });
    }
  }

  return { dueSlots: dueSlots.length, dueOneShots: dueOneShots.length, missed };
}

// Réexport commodité pour l'UI (upcoming).
export { listSlots, getSlot };
export type { Slot };
