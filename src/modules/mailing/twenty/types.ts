// Types du CRM Twenty — on ne modélise QUE les champs utilisés par Posty
// (§3.1 CDC-02, garantie « aucun champ nouveau »). Si Twenty renvoie d'autres
// champs, ils sont ignorés.

export const COMPANY_STATUSES = ["PROSPECT", "CLIENT", "PARTENAIRE"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export interface TwentyEmail {
  primaryEmail: string | null;
}

export interface TwentyCompany {
  id: string;
  name: string;
  status: CompanyStatus | null;
  isAutoHandled: boolean;
  toContact: boolean;
  followupCount: number;
  lastContactedAt: string | null; // ISO date
  nextFollowupAt: string | null;
  lastMessageId: string | null;
  messageReferences: string | null;
  contactEmail: TwentyEmail | null;
}

/**
 * Patch appliqué par Posty. TOUS les champs sont ceux déjà écrits par n8n :
 * pas de champ nouveau dans Twenty. C'est ce qui permet un retour arrière
 * instantané vers les workflows n8n.
 */
export interface TwentyCompanyPatch {
  toContact?: boolean;
  followupCount?: number;
  lastContactedAt?: string; // ISO
  nextFollowupAt?: string;
  lastMessageId?: string;
  messageReferences?: string;
  isAutoHandled?: boolean;
  // Champ EXISTANT dans Twenty (§1.3 — les 3 statuts natifs) ; jamais écrit
  // par n8n mais nécessaire pour la promotion post-réponse (§8.2, action
  // « Passer en CLIENT »). Ne viole pas §3.1 « aucun champ nouveau ».
  status?: CompanyStatus;
}

export interface ListCompaniesOptions {
  isAutoHandled?: boolean;
  status?: CompanyStatus;
  toContact?: boolean;
  limit?: number;
  cursor?: string | null;
}

export interface ListCompaniesResult {
  items: TwentyCompany[];
  nextCursor: string | null;
}

export interface TwentyClient {
  listCompanies(opts?: ListCompaniesOptions): Promise<ListCompaniesResult>;
  getCompany(id: string): Promise<TwentyCompany | null>;
  patchCompany(id: string, patch: TwentyCompanyPatch): Promise<void>;
  ping(): Promise<{ ok: true } | { ok: false; error: string }>;
}

export class TwentyApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly bodySnippet: string,
  ) {
    super(message);
    this.name = "TwentyApiError";
  }
}
