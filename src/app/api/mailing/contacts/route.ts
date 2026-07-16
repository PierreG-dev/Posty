import { NextResponse } from "next/server";
import { twentyFromEnv, type CompanyStatus, COMPANY_STATUSES } from "@/modules/mailing/twenty";
import { listMetaByIds } from "@/modules/mailing/repositories/company-meta-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseStatus(v: string | null): CompanyStatus | undefined {
  if (!v) return undefined;
  return (COMPANY_STATUSES as readonly string[]).includes(v) ? (v as CompanyStatus) : undefined;
}

export async function GET(req: Request) {
  const client = twentyFromEnv();
  if (!client) {
    return NextResponse.json(
      { error: "TWENTY_API_URL ou TWENTY_API_KEY manquant dans .env" },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const status = parseStatus(url.searchParams.get("status"));
  const isAutoParam = url.searchParams.get("isAutoHandled");
  const isAutoHandled = isAutoParam == null ? undefined : isAutoParam === "true";
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? "50"));

  const { items, nextCursor } = await client.listCompanies({ status, isAutoHandled, limit });
  const metas = await listMetaByIds(items.map((c) => c.id));

  const contacts = items.map((c) => ({
    ...c,
    meta: metas.get(c.id) ?? null,
  }));

  return NextResponse.json({ contacts, nextCursor });
}
