import { NextResponse } from "next/server";
import { getCampaign } from "@/modules/mailing/repositories/campaigns-repo";
import { buildCampaignPreviews } from "@/modules/mailing/services/campaigns-enqueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * §6.4 — aperçu obligatoire avant mise en file. Tire 3 destinataires
 * éligibles au hasard et rend le mail final.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  const previews = await buildCampaignPreviews(campaign, { sampleSize: 3 });
  return NextResponse.json({ previews });
}
