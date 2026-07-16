import { NextResponse } from "next/server";
import { projectUpcoming } from "@/modules/linkedin/services/upcoming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const n = Math.max(1, Math.min(20, Number(url.searchParams.get("n") ?? "5") || 5));
  const items = await projectUpcoming(n);
  return NextResponse.json({ items });
}
