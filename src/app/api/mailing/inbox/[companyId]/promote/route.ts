import { NextResponse } from "next/server";
import { setPaused } from "@/modules/mailing/repositories/company-meta-repo";
import { twentyFromEnv } from "@/modules/mailing/twenty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// §8.2 — « Passer en CLIENT dans Twenty » : c'est le seul cas où Posty
// change le statut Twenty après une réponse, et il faut une action humaine
// explicite. La pause est levée en même temps (le contact sort de la
// séquence auto — il est CLIENT — mais reste éligible aux campagnes).
export async function POST(_req: Request, ctx: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await ctx.params;
  const twenty = twentyFromEnv();
  if (!twenty) {
    return NextResponse.json({ error: "Twenty non configuré" }, { status: 500 });
  }
  try {
    // Twenty n'a pas de champ 'status' natif écrit par n8n — le CDC parle
    // du statut logique. Selon la modélisation Twenty (champ personnalisé
    // 'status' déjà utilisé par n8n implicitement via le Switch), on
    // PATCHe le même champ. Si le nom réel diverge côté Twenty, ajuster
    // ici — la valeur "CLIENT" est celle du domaine (§1.3).
    await twenty.patchCompany(companyId, { status: "CLIENT" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
  await setPaused(companyId, false, null);
  return NextResponse.json({ ok: true });
}
