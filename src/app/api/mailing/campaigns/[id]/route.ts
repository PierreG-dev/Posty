import { NextResponse } from "next/server";
import { campaignInputSchema } from "@/modules/mailing/domain/campaigns";
import {
  deleteCampaignDraft,
  getCampaign,
  refreshCampaignStats,
  updateCampaignDraft,
} from "@/modules/mailing/repositories/campaigns-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  // Rafraîchit les stats à la lecture — cheap, et évite qu'un compteur
  // sur la liste devienne stale.
  if (campaign.status !== "draft") {
    await refreshCampaignStats(id);
  }
  const fresh = await getCampaign(id);
  return NextResponse.json({ campaign: fresh });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = campaignInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload invalide", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const campaign = await updateCampaignDraft(id, parsed.data);
  if (!campaign) {
    // Soit inexistant, soit déjà queued (immuable — voir décision plan §1).
    const existing = await getCampaign(id);
    if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    return NextResponse.json(
      { error: "Campagne verrouillée : elle a déjà été mise en file." },
      { status: 409 },
    );
  }
  return NextResponse.json({ campaign });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = await deleteCampaignDraft(id);
  if (!ok) {
    const existing = await getCampaign(id);
    if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    return NextResponse.json(
      { error: "Suppression interdite : la campagne n'est plus en brouillon." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
