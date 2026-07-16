import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/modules/shared/db/mongoose";
import { SettingsModel, SETTINGS_ID } from "@/modules/shared/settings/model";
import { getSettings } from "@/modules/shared/settings/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Petit sous-ensemble des settings, mutable depuis l'UI LinkedIn.
// Les autres champs (pushover, linkedin.*, ai) ont ou auront leur propre route.
const patchSchema = z
  .object({
    autoGeneration: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    minQueueAlert: z.number().int().min(0).max(50).optional(),
  })
  .strict();

export async function GET() {
  const s = await getSettings();
  // On ne renvoie PAS les tokens LinkedIn.
  return NextResponse.json({
    autoGeneration: s.autoGeneration,
    dryRun: s.dryRun,
    minQueueAlert: s.minQueueAlert,
  });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  await connectDb();
  await SettingsModel.updateOne({ _id: SETTINGS_ID }, { $set: parsed.data }, { upsert: true });
  const s = await getSettings();
  return NextResponse.json({
    autoGeneration: s.autoGeneration,
    dryRun: s.dryRun,
    minQueueAlert: s.minQueueAlert,
  });
}
