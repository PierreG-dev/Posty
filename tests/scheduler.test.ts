import { describe, it, expect, beforeAll } from "vitest";

// Force le TZ conteneur AVANT tout import Luxon (Node lit TZ à la construction
// du process, mais Luxon lit les zones à la demande). Objectif : s'assurer que
// les calculs de créneaux sont ancrés Paris QUEL QUE SOIT le TZ du conteneur.
beforeAll(() => {
  process.env.TZ = "UTC";
});

import { DateTime } from "luxon";
import {
  CATCHUP_WINDOW_MIN,
  computeDueOneShots,
  computeDueSlots,
  oneShotIdempotencyKey,
  slotIdempotencyKey,
  slotLockKey,
} from "@/modules/linkedin/services/scheduler";
import type { Slot } from "@/modules/linkedin/domain/slot";
import type { Post } from "@/modules/linkedin/domain/post";

function slot(overrides: Partial<Slot>): Slot {
  return {
    _id: "s1",
    label: "",
    dayOfWeek: 2,
    time: "09:00",
    themeId: "t1",
    modeOverride: null,
    active: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function post(overrides: Partial<Post>): Post {
  return {
    _id: "p1",
    content: "x",
    hashtags: [],
    themeId: null,
    status: "scheduled",
    source: "manual",
    media: { kind: "none", assetId: null, altText: "", title: "" },
    firstComment: { text: null, status: "none" },
    queuePosition: 0,
    scheduledAt: null,
    publishedAt: null,
    linkedin: { urn: null, url: null },
    attempts: 0,
    lastError: null,
    aiMeta: null,
    sourceExternalId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe("computeDueSlots — ancrage Paris malgré TZ=UTC", () => {
  it("un slot mardi 09:00 se déclenche à 09:00 heure de Paris (été → 07:00 UTC)", () => {
    // 2026-07-14 est un mardi. 09:00 Paris (CEST +02) = 07:00 UTC.
    const s = slot({ dayOfWeek: 2, time: "09:00" });
    const nowUtc09Paris = DateTime.fromISO("2026-07-14T07:00:00Z", { zone: "utc" }).toJSDate();
    const due = computeDueSlots([s], nowUtc09Paris);
    expect(due).toHaveLength(1);
    expect(due[0]!.slot._id).toBe("s1");
    // La clé d'idempotence est ancrée Paris — c'est ce qui garantit qu'un tick
    // en UTC ne génère pas une clé "wrong day".
    expect(slotIdempotencyKey(s._id, due[0]!.scheduledAtParis)).toBe("s1-2026-07-14-09:00");
  });

  it("NE se déclenche PAS à 09:00 UTC (= 11:00 Paris en été)", () => {
    const s = slot({ dayOfWeek: 2, time: "09:00" });
    const nowUtc09 = DateTime.fromISO("2026-07-14T09:00:00Z", { zone: "utc" }).toJSDate();
    // À 09:00 UTC il est déjà 11:00 Paris → 2h après le créneau → hors fenêtre.
    const due = computeDueSlots([s], nowUtc09);
    expect(due).toHaveLength(0);
  });

  it("un slot inactif n'est jamais dû", () => {
    const s = slot({ active: false });
    const at = DateTime.fromISO("2026-07-14T07:00:00Z", { zone: "utc" }).toJSDate();
    expect(computeDueSlots([s], at)).toHaveLength(0);
  });

  it("un slot mardi n'est pas dû un mercredi", () => {
    const s = slot({ dayOfWeek: 2, time: "09:00" });
    const wednesday = DateTime.fromISO("2026-07-15T07:00:00Z", { zone: "utc" }).toJSDate();
    expect(computeDueSlots([s], wednesday)).toHaveLength(0);
  });

  it("rattrapage : un créneau raté depuis 10 min est ENCORE dû", () => {
    const s = slot({ time: "09:00" });
    const t10 = DateTime.fromISO("2026-07-14T07:10:00Z", { zone: "utc" }).toJSDate();
    expect(computeDueSlots([s], t10)).toHaveLength(1);
  });

  it("un créneau raté depuis 3 h N'EST PLUS dû (skipped)", () => {
    // C'est le test qui garantit qu'on ne publie pas à 3 h du matin après un redéploiement.
    const s = slot({ time: "09:00" });
    const t3h = DateTime.fromISO("2026-07-14T10:00:00Z", { zone: "utc" }).toJSDate(); // 12:00 Paris
    expect(computeDueSlots([s], t3h)).toHaveLength(0);
  });

  it(`fenêtre de rattrapage = ${CATCHUP_WINDOW_MIN} min pile`, () => {
    const s = slot({ time: "09:00" });
    const in15 = DateTime.fromISO("2026-07-14T07:15:00Z", { zone: "utc" }).toJSDate();
    const in16 = DateTime.fromISO("2026-07-14T07:16:00Z", { zone: "utc" }).toJSDate();
    expect(computeDueSlots([s], in15)).toHaveLength(1);
    expect(computeDueSlots([s], in16)).toHaveLength(0);
  });
});

describe("computeDueOneShots", () => {
  it("un one-shot dont scheduledAt est passé de 5 min est à publier", () => {
    const p = post({ scheduledAt: new Date(Date.now() - 5 * 60_000) });
    const r = computeDueOneShots([p], new Date());
    expect(r).toHaveLength(1);
    expect(r[0]!.missed).toBe(false);
  });

  it("un one-shot manqué de > 15 min est marqué missed", () => {
    const p = post({ scheduledAt: new Date(Date.now() - 30 * 60_000) });
    const r = computeDueOneShots([p], new Date());
    expect(r[0]!.missed).toBe(true);
  });

  it("ignore les posts qui ne sont pas `scheduled`", () => {
    const p = post({ status: "queued", scheduledAt: new Date(Date.now() - 5 * 60_000) });
    expect(computeDueOneShots([p], new Date())).toHaveLength(0);
  });

  it("ignore les posts scheduledAt dans le futur", () => {
    const p = post({ scheduledAt: new Date(Date.now() + 60 * 60_000) });
    expect(computeDueOneShots([p], new Date())).toHaveLength(0);
  });
});

describe("clés d'idempotence et de verrou", () => {
  it("slotIdempotencyKey est stable, ancré Paris, minute-précise", () => {
    const at = DateTime.fromObject(
      { year: 2026, month: 7, day: 14, hour: 9, minute: 0 },
      { zone: "Europe/Paris" },
    );
    expect(slotIdempotencyKey("slot-a", at)).toBe("slot-a-2026-07-14-09:00");
  });

  it("slotLockKey est ancré jour Paris", () => {
    const at = DateTime.fromObject(
      { year: 2026, month: 7, day: 14, hour: 9, minute: 0 },
      { zone: "Europe/Paris" },
    );
    expect(slotLockKey("slot-a", at)).toBe("publish:slot-a:2026-07-14");
  });

  it("oneShotIdempotencyKey = 'oneshot-{postId}'", () => {
    expect(oneShotIdempotencyKey("p42")).toBe("oneshot-p42");
  });
});
