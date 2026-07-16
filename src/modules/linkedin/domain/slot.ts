import { z } from "zod";

// CDC-01 §6.2 — créneaux récurrents.
export const SLOT_MODE_OVERRIDES = ["queue", "auto"] as const;
export type SlotModeOverride = (typeof SLOT_MODE_OVERRIDES)[number];

// ISO weekday : 1 = lundi … 7 = dimanche.
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const slotInputSchema = z.object({
  label: z.string().trim().max(60).default(""),
  dayOfWeek: z.number().int().min(1).max(7),
  time: z.string().regex(TIME_RE, "HH:mm attendu"),
  themeId: z.string().min(1),
  modeOverride: z.enum(SLOT_MODE_OVERRIDES).nullable().default(null),
  active: z.boolean().default(true),
});

export type SlotInput = z.infer<typeof slotInputSchema>;

export const slotPatchSchema = slotInputSchema.partial();
export type SlotPatch = z.infer<typeof slotPatchSchema>;

export interface Slot {
  _id: string;
  label: string;
  dayOfWeek: number;
  time: string;
  themeId: string;
  modeOverride: SlotModeOverride | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
