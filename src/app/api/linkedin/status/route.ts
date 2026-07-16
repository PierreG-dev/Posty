import { NextResponse } from "next/server";
import { getLinkedInStatus } from "@/modules/shared/settings/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const status = await getLinkedInStatus();
  return NextResponse.json({ status });
}
