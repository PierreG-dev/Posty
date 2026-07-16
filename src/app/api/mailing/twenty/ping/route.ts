import { NextResponse } from "next/server";
import { twentyFromEnv } from "@/modules/mailing/twenty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const client = twentyFromEnv();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "TWENTY_API_URL ou TWENTY_API_KEY manquant dans .env" },
      { status: 503 },
    );
  }
  const res = await client.ping();
  return NextResponse.json(res);
}
