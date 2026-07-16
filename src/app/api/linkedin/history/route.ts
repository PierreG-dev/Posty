import { NextResponse } from "next/server";
import { listPublications } from "@/modules/linkedin/repositories/publication-repo";
import { PUBLICATION_OUTCOMES, type PublicationOutcome } from "@/modules/linkedin/repositories/publication-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const outcomeRaw = url.searchParams.get("outcome");
  const postId = url.searchParams.get("postId") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const outcome =
    outcomeRaw && (PUBLICATION_OUTCOMES as readonly string[]).includes(outcomeRaw)
      ? (outcomeRaw as PublicationOutcome)
      : undefined;
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 100;
  const publications = await listPublications({ outcome, postId, limit: Number.isFinite(limit) ? limit : 100 });
  return NextResponse.json({ publications });
}
