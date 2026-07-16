import { NextResponse } from "next/server";
import { slotPatchSchema } from "@/modules/linkedin/domain/slot";
import { deleteSlot, getSlot, updateSlot } from "@/modules/linkedin/repositories/slot-repo";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const slot = await getSlot(id);
  if (!slot) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({ slot });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = slotPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  const slot = await updateSlot(id, parsed.data);
  if (!slot) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({ slot });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ok = await deleteSlot(id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Introuvable" }, { status: 404 });
}
