import { NextResponse } from "next/server";
import { getAsset, readAssetBinary } from "@/modules/linkedin/repositories/asset-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sert un asset stocké dans ASSETS_DIR. La protection est déjà assurée par le
// middleware d'auth (tout hors /login et /api/linkedin/callback est protégé).

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const asset = await getAsset(id);
  if (!asset) return NextResponse.json({ error: "Asset introuvable" }, { status: 404 });
  const bin = await readAssetBinary(asset);
  return new Response(new Uint8Array(bin), {
    status: 200,
    headers: {
      "content-type": asset.mimeType,
      "cache-control": "private, max-age=31536000, immutable",
      "content-disposition": `inline; filename="${asset.filename}"`,
    },
  });
}
