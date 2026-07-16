import { NextResponse } from "next/server";
import { campaignInputSchema } from "@/modules/mailing/domain/campaigns";
import {
  createCampaign,
  listCampaigns,
} from "@/modules/mailing/repositories/campaigns-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const campaigns = await listCampaigns();
  return NextResponse.json({ campaigns });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = campaignInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload invalide", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const campaign = await createCampaign(parsed.data);
  return NextResponse.json({ campaign }, { status: 201 });
}
