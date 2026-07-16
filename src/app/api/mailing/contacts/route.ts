import { NextResponse } from "next/server";
import { twentyFromEnv, type CompanyStatus, COMPANY_STATUSES, type TwentyCompany } from "@/modules/mailing/twenty";
import { listMetaByIds } from "@/modules/mailing/repositories/company-meta-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Plafond dur pour éviter qu'un compte Twenty énorme ne fasse exploser la
// requête. 500 couvre largement le cas mono-utilisateur (~quelques centaines
// de sociétés). Au-delà, on renvoie ce qu'on a et on documente `truncated`.
const MAX_ITEMS = 500;

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
  const requested = Math.min(MAX_ITEMS, Number(url.searchParams.get("limit") ?? "50"));

  // Twenty pagine côté serveur (~20-60/page) : on suit `nextCursor` jusqu'à
  // atteindre `requested` ou épuisement. Sans ça l'UI ne voit qu'une page.
  const items: TwentyCompany[] = [];
  let cursor: string | null | undefined = undefined;
  let truncated = false;
  while (items.length < requested) {
    const pageSize = Math.min(60, requested - items.length);
    const res = await client.listCompanies({ status, isAutoHandled, limit: pageSize, cursor: cursor ?? undefined });
    items.push(...res.items);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
    if (items.length >= MAX_ITEMS) {
      truncated = true;
      break;
    }
  }

  const metas = await listMetaByIds(items.map((c) => c.id));

  const contacts = items.map((c) => ({
    ...c,
    meta: metas.get(c.id) ?? null,
  }));

  return NextResponse.json({ contacts, truncated });
}
