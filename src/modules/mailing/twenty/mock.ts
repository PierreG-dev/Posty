import type {
  ListCompaniesOptions,
  ListCompaniesResult,
  TwentyClient,
  TwentyCompany,
  TwentyCompanyPatch,
} from "./types";

/** Client Twenty en mémoire, pour tests. */
export class MockTwentyClient implements TwentyClient {
  public companies: Map<string, TwentyCompany>;

  constructor(seed: readonly TwentyCompany[] = []) {
    this.companies = new Map(seed.map((c) => [c.id, { ...c }]));
  }

  async listCompanies(opts: ListCompaniesOptions = {}): Promise<ListCompaniesResult> {
    let items = [...this.companies.values()];
    if (typeof opts.isAutoHandled === "boolean") items = items.filter((c) => c.isAutoHandled === opts.isAutoHandled);
    if (opts.status) items = items.filter((c) => c.status === opts.status);
    if (typeof opts.toContact === "boolean") items = items.filter((c) => c.toContact === opts.toContact);
    if (opts.limit) items = items.slice(0, opts.limit);
    return { items, nextCursor: null };
  }

  async getCompany(id: string): Promise<TwentyCompany | null> {
    return this.companies.get(id) ?? null;
  }

  async patchCompany(id: string, patch: TwentyCompanyPatch): Promise<void> {
    const existing = this.companies.get(id);
    if (!existing) throw new Error(`MockTwentyClient: company ${id} inconnue`);
    this.companies.set(id, { ...existing, ...patch });
  }

  async ping(): Promise<{ ok: true } | { ok: false; error: string }> {
    return { ok: true };
  }
}
