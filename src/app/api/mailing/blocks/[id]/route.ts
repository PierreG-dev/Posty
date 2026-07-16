import { NextResponse } from "next/server";
import { mailBlockInputSchema } from "@/modules/mailing/domain/mail-blocks";
import { deleteBlock, getBlock, updateBlock } from "@/modules/mailing/repositories/mail-blocks-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const block = await getBlock(id);
  if (!block) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({ block });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = mailBlockInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  const block = await updateBlock(id, parsed.data);
  if (!block) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({ block });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = await deleteBlock(id);
  if (!ok) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
