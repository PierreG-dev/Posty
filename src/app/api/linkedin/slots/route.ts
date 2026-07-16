import { NextResponse } from "next/server";
import { slotInputSchema } from "@/modules/linkedin/domain/slot";
import { createSlot, listSlots } from "@/modules/linkedin/repositories/slot-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const activeOnly = url.searchParams.get("active") === "true";
  const slots = await listSlots({ activeOnly });
  return NextResponse.json({ slots });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = slotInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  const slot = await createSlot(parsed.data);
  return NextResponse.json({ slot }, { status: 201 });
}
