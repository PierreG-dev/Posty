import { NextResponse } from "next/server";
import { setPaused } from "@/modules/mailing/repositories/company-meta-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// §8.2 — « Reprendre la séquence » : lève la pause 'reply'. Aucun autre effet
// (pas de re-enqueue automatique ; le job d'éligibilité du lendemain fera le
// travail si le contact est encore éligible).
export async function POST(_req: Request, ctx: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await ctx.params;
  await setPaused(companyId, false, null);
  return NextResponse.json({ ok: true });
}
