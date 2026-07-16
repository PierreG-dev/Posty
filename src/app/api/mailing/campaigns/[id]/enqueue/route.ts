import { NextResponse } from "next/server";
import { enqueueCampaign } from "@/modules/mailing/services/campaigns-enqueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * §6.4 — « Mettre en file ». Crée N entrées mail_queue en priority=3 et
 * passe la campagne en 'queued'. Ré-applique l'éligibilité côté serveur
 * (garde-fou : un id forcé côté client qui ne passe pas ne sera pas enfilé).
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const result = await enqueueCampaign(id);
  if (!result.ok) {
    const codeByReason: Record<string, number> = {
      not_found: 404,
      not_draft: 409,
      no_targets: 400,
      no_twenty: 503,
    };
    return NextResponse.json(
      { error: result.reason, ...("currentStatus" in result ? { currentStatus: result.currentStatus } : {}) },
      { status: codeByReason[result.reason] ?? 400 },
    );
  }
  return NextResponse.json(result);
}
