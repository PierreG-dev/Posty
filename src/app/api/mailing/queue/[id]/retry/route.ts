import { NextResponse } from "next/server";
import { retryFailed } from "@/modules/mailing/repositories/mail-queue-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = await retryFailed(id);
  if (!ok) return NextResponse.json({ error: "non ré-ouvrable" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
