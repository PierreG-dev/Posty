import { NextResponse } from "next/server";
import { z } from "zod";
import { twentyFromEnv } from "@/modules/mailing/twenty";
import { listMetaByIds } from "@/modules/mailing/repositories/company-meta-repo";
import { findCampaignRecipientIds, getCampaign } from "@/modules/mailing/repositories/campaigns-repo";
import { computeCampaignAudience, notFoundDecision } from "@/modules/mailing/services/campaigns-audience";
import type { TwentyCompany } from "@/modules/mailing/twenty/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  candidateIds: z.array(z.string()).min(1).max(2000),
});

/**
 * Retourne la ventilation éligibles / exclus pour la liste d'ids passée.
 * L'UI compose son tableau à partir d'ici — les exclusions sont AFFICHÉES et
 * verrouillées, mais l'API réappliquera de toute façon à l'enfilement.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  const twenty = twentyFromEnv();
  if (!twenty) {
    return NextResponse.json({ error: "Twenty non configuré" }, { status: 503 });
  }

  // Chaque id demandé DOIT ressortir avec une decision — sinon le composer
  // considère silencieusement l'id éligible (bug historique : un id sans
  // decision passait dans "Tout cocher les éligibles" puis était rejeté à
  // l'enfilement). Les getCompany qui échouent produisent une decision
  // synthétique `not_found`.
  const companies: TwentyCompany[] = [];
  const notFound = new Set<string>();
  for (const cid of parsed.data.candidateIds) {
    try {
      const c = await twenty.getCompany(cid);
      if (c) companies.push(c);
      else notFound.add(cid);
    } catch {
      notFound.add(cid);
    }
  }
  const [metas, alreadyIds] = await Promise.all([
    listMetaByIds(companies.map((c) => c.id)),
    findCampaignRecipientIds(id),
  ]);
  const computed = computeCampaignAudience({
    contacts: companies.map((c) => ({ company: c, meta: metas.get(c.id) ?? null })),
    alreadyRecipientIds: alreadyIds,
  });
  const decisions = [
    ...computed,
    ...Array.from(notFound).map((cid) => notFoundDecision(cid)),
  ];
  return NextResponse.json({ decisions });
}
