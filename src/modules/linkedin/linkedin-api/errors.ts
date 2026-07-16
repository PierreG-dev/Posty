export type LinkedInErrorKind =
  | "unauthorized"
  | "rate_limited"
  | "validation"
  | "server"
  | "network"
  | "not_found"
  | "forbidden";

export class LinkedInApiError extends Error {
  readonly kind: LinkedInErrorKind;
  readonly status: number | null;
  readonly serviceErrorCode: number | null;
  readonly responseSnippet: string | null;

  constructor(opts: {
    kind: LinkedInErrorKind;
    status: number | null;
    message: string;
    serviceErrorCode?: number | null;
    responseSnippet?: string | null;
  }) {
    super(opts.message);
    this.name = "LinkedInApiError";
    this.kind = opts.kind;
    this.status = opts.status;
    this.serviceErrorCode = opts.serviceErrorCode ?? null;
    this.responseSnippet = opts.responseSnippet ?? null;
  }
}

/** Tronque une réponse pour la journaliser (limite `publications.linkedinResponse` : 4 Ko §6.5). */
export function truncateResponse(raw: string, max = 4096): string {
  if (raw.length <= max) return raw;
  return raw.slice(0, max) + `…[+${raw.length - max}]`;
}
