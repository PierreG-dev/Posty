import { NextResponse } from "next/server";
import { markCancelled } from "@/modules/mailing/repositories/mail-queue-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await markCancelled(id, "manual");
  return NextResponse.json({ ok: true });
}
