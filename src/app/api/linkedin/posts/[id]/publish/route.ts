import { NextResponse } from "next/server";
import { publishPost } from "@/modules/linkedin/services/publisher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Bouton « Publier maintenant » de l'UI (§12). Mode `manual`. */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const result = await publishPost(id, { mode: "manual" });
  const status =
    result.outcome === "published" || result.outcome === "skipped_dry_run"
      ? 200
      : result.outcome === "not_publishable" || result.outcome === "duplicate"
        ? 409
        : result.outcome === "not_connected"
          ? 401
          : 502;
  return NextResponse.json({ result }, { status });
}
