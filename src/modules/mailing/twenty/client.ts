import {
  COMPANY_STATUSES,
  type CompanyStatus,
  type ListCompaniesOptions,
  type ListCompaniesResult,
  type TwentyClient,
  type TwentyCompany,
  type TwentyCompanyPatch,
  TwentyApiError,
} from "./types";

// Client HTTP Twenty. Le token vient d'un CALLBACK d'invocation, pas d'une
// lecture d'env directe : c'est ce qui rend le client mockable en test et ce
// qui garantit qu'on ne peut PAS le mettre par erreur en query string.
//
// Header UNIQUEMENT : `Authorization: Bearer <TOKEN>`. Voir §0 CDC-02.

interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface HttpTwentyClientOpts {
  baseUrl: string; // ex. https://crm.mondomaine.fr
  token: string;
  fetchImpl?: FetchLike;
}

function isCompanyStatus(s: unknown): s is CompanyStatus {
  return typeof s === "string" && (COMPANY_STATUSES as readonly string[]).includes(s);
}

function coerceCompany(raw: unknown): TwentyCompany {
  const o = raw as Record<string, unknown>;
  const email = o.contactEmail as Record<string, unknown> | null | undefined;
  return {
    id: String(o.id),
    name: typeof o.name === "string" ? o.name : "",
    status: isCompanyStatus(o.status) ? o.status : null,
    isAutoHandled: Boolean(o.isAutoHandled),
    toContact: Boolean(o.toContact),
    followupCount: typeof o.followupCount === "number" ? o.followupCount : 0,
    lastContactedAt: typeof o.lastContactedAt === "string" ? o.lastContactedAt : null,
    nextFollowupAt: typeof o.nextFollowupAt === "string" ? o.nextFollowupAt : null,
    lastMessageId: typeof o.lastMessageId === "string" ? o.lastMessageId : null,
    messageReferences: typeof o.messageReferences === "string" ? o.messageReferences : null,
    contactEmail: email
      ? { primaryEmail: typeof email.primaryEmail === "string" ? email.primaryEmail : null }
      : null,
  };
}

/**
 * Sérialise les filtres au format Twenty REST : `filter=field[eq]:value,...`
 * On garde ça minimal : les seuls filtres dont on a besoin.
 */
function buildListQuery(opts: ListCompaniesOptions): string {
  const filters: string[] = [];
  if (typeof opts.isAutoHandled === "boolean") filters.push(`isAutoHandled[eq]:${opts.isAutoHandled}`);
  if (opts.status) filters.push(`status[eq]:${opts.status}`);
  if (typeof opts.toContact === "boolean") filters.push(`toContact[eq]:${opts.toContact}`);
  const qs = new URLSearchParams();
  if (filters.length > 0) qs.set("filter", filters.join(","));
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.cursor) qs.set("starting_after", opts.cursor);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export class HttpTwentyClient implements TwentyClient {
  private readonly f: FetchLike;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(opts: HttpTwentyClientOpts) {
    if (!opts.baseUrl) throw new Error("TwentyClient: baseUrl manquant");
    if (!opts.token) throw new Error("TwentyClient: token manquant");
    if (/[?&]token=/i.test(opts.baseUrl)) {
      // Garde-fou explicite : le token n'a rien à faire dans l'URL. Voir §0.
      throw new Error("TwentyClient: le token ne doit JAMAIS être en query string");
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.f = opts.fetchImpl ?? fetch;
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  private async parseError(res: Response): Promise<TwentyApiError> {
    const text = await res.text().catch(() => "");
    return new TwentyApiError(res.status, `Twenty ${res.status}: ${text.slice(0, 200)}`, text.slice(0, 500));
  }

  async listCompanies(opts: ListCompaniesOptions = {}): Promise<ListCompaniesResult> {
    const url = `${this.baseUrl}/rest/companies${buildListQuery(opts)}`;
    const res = await this.f(url, { headers: this.headers() });
    if (!res.ok) throw await this.parseError(res);
    const json = (await res.json()) as {
      data?: { companies?: unknown[] };
      pageInfo?: { endCursor?: string | null; hasNextPage?: boolean };
    };
    const raw = json.data?.companies ?? [];
    const items = raw.map(coerceCompany);
    const nextCursor = json.pageInfo?.hasNextPage ? json.pageInfo?.endCursor ?? null : null;
    return { items, nextCursor };
  }

  async getCompany(id: string): Promise<TwentyCompany | null> {
    const url = `${this.baseUrl}/rest/companies/${encodeURIComponent(id)}`;
    const res = await this.f(url, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw await this.parseError(res);
    const json = (await res.json()) as { data?: { company?: unknown } };
    if (!json.data?.company) return null;
    return coerceCompany(json.data.company);
  }

  async patchCompany(id: string, patch: TwentyCompanyPatch): Promise<void> {
    const url = `${this.baseUrl}/rest/companies/${encodeURIComponent(id)}`;
    const res = await this.f(url, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw await this.parseError(res);
  }

  async ping(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.listCompanies({ limit: 1 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
