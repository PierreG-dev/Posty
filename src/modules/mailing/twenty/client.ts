import { logger } from "@/modules/shared/logger";
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
  // Retry sur erreurs transitoires (429, 5xx, throw réseau). Défaut : 3
  // tentatives avec backoff exponentiel. Mettre `maxAttempts: 1` en test
  // pour désactiver.
  maxAttempts?: number;
  // Base du backoff en ms — le délai entre l'essai N et N+1 est
  // `backoffBaseMs * 2^(N-1)`. Défaut 200ms → 200, 400, 800…
  backoffBaseMs?: number;
}

// Codes HTTP considérés transitoires — on retry. Le reste (400, 401, 403,
// 404) est final : pas de retry, on remonte l'erreur (ou null pour 404).
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

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
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;

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
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
    this.backoffBaseMs = Math.max(0, opts.backoffBaseMs ?? 200);
  }

  /**
   * Fetch avec retry sur les erreurs transitoires (429, 5xx, throw réseau).
   * Motivation : 86 appels séquentiels rapides (enfilement d'une campagne)
   * déclenchent occasionnellement des throws ECONNRESET / timeouts / 429
   * côté undici sans que Twenty soit down. Sans retry, ces contacts étaient
   * silencieusement comptés `notFound` alors qu'ils sont bien là.
   */
  private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (attempt > 1) {
        const delay = this.backoffBaseMs * Math.pow(2, attempt - 2);
        await new Promise((r) => setTimeout(r, delay));
      }
      try {
        const res = await this.f(url, init);
        if (TRANSIENT_STATUS.has(res.status) && attempt < this.maxAttempts) {
          logger.warn("mailing.twenty.transient_retry", { url, status: res.status, attempt });
          lastError = new TwentyApiError(res.status, `HTTP ${res.status}`, "");
          continue;
        }
        return res;
      } catch (err) {
        lastError = err;
        if (attempt < this.maxAttempts) {
          logger.warn("mailing.twenty.throw_retry", {
            url,
            attempt,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error("Twenty fetch failed after retries");
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
    const res = await this.fetchWithRetry(url, { headers: this.headers() });
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
    const res = await this.fetchWithRetry(url, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw await this.parseError(res);
    const json = (await res.json()) as { data?: { company?: unknown } };
    if (!json.data?.company) {
      logger.warn("mailing.twenty.get_company_unexpected_shape", {
        id,
        status: res.status,
        keys: Object.keys(json ?? {}),
      });
      return null;
    }
    return coerceCompany(json.data.company);
  }

  async patchCompany(id: string, patch: TwentyCompanyPatch): Promise<void> {
    const url = `${this.baseUrl}/rest/companies/${encodeURIComponent(id)}`;
    const res = await this.fetchWithRetry(url, {
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
