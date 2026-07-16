import { NextResponse } from "next/server";
import {
  cancelPendingForCampaign,
  getCampaign,
  refreshCampaignStats,
  setCampaignStatus,
} from "@/modules/mailing/repositories/campaigns-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Annule les entrées `pending` restantes ; les `sending` sont laissées
 * (le mail va partir) et les `sent` restent terminales. La campagne passe
 * `cancelled` avec completedAt=now.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  if (campaign.status === "done" || campaign.status === "cancelled") {
    return NextResponse.json(
      { error: `Campagne déjà ${campaign.status}` },
      { status: 409 },
    );
  }
  const cancelled = await cancelPendingForCampaign(id);
  await setCampaignStatus(id, "cancelled", { completedAt: new Date() });
  const stats = await refreshCampaignStats(id);
  return NextResponse.json({ ok: true, cancelled, stats });
}
