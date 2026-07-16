import { env } from "@/modules/shared/env";
import { logger } from "@/modules/shared/logger";
import { LinkedInApiError, truncateResponse } from "./errors";
import {
  type LinkedInClient,
  type PublishInput,
  type PublishResult,
  type RefreshResult,
  type UploadInit,
  type UserInfo,
  urnToFeedUrl,
} from "./types";

const REST_BASE = "https://api.linkedin.com/rest";
const AUTH_BASE = "https://www.linkedin.com/oauth/v2";
const USERINFO = "https://api.linkedin.com/v2/userinfo";

interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

function classifyStatus(status: number): "unauthorized" | "rate_limited" | "validation" | "server" | "forbidden" | "not_found" | "network" {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 422 || status === 400) return "validation";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "network";
}

async function parseError(res: Response): Promise<LinkedInApiError> {
  const text = await res.text().catch(() => "");
  let serviceErrorCode: number | null = null;
  try {
    const j = JSON.parse(text) as { serviceErrorCode?: number; code?: string; message?: string };
    if (typeof j.serviceErrorCode === "number") serviceErrorCode = j.serviceErrorCode;
  } catch {
    // corps non JSON — on garde le texte brut
  }
  return new LinkedInApiError({
    kind: classifyStatus(res.status),
    status: res.status,
    message: `LinkedIn ${res.status}: ${text.slice(0, 200)}`,
    serviceErrorCode,
    responseSnippet: truncateResponse(text),
  });
}

export class PostsApiClient implements LinkedInClient {
  private readonly f: FetchLike;
  private readonly apiVersion: string;

  constructor(opts?: { fetchImpl?: FetchLike; apiVersion?: string }) {
    this.f = opts?.fetchImpl ?? fetch;
    this.apiVersion = opts?.apiVersion ?? env().LINKEDIN_API_VERSION;
  }

  private restHeaders(accessToken: string): HeadersInit {
    return {
      Authorization: `Bearer ${accessToken}`,
      "LinkedIn-Version": this.apiVersion,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
    };
  }

  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const res = await this.f(USERINFO, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw await parseError(res);
    const j = (await res.json()) as { sub: string; name?: string; email?: string };
    return { sub: j.sub, name: j.name, email: j.email };
  }

  async initImageUpload(accessToken: string, ownerUrn: string): Promise<UploadInit> {
    const res = await this.f(`${REST_BASE}/images?action=initializeUpload`, {
      method: "POST",
      headers: this.restHeaders(accessToken),
      body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
    });
    if (!res.ok) throw await parseError(res);
    const j = (await res.json()) as { value: { uploadUrl: string; image: string } };
    return { uploadUrl: j.value.uploadUrl, urn: j.value.image };
  }

  async initDocumentUpload(accessToken: string, ownerUrn: string): Promise<UploadInit> {
    const res = await this.f(`${REST_BASE}/documents?action=initializeUpload`, {
      method: "POST",
      headers: this.restHeaders(accessToken),
      body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
    });
    if (!res.ok) throw await parseError(res);
    const j = (await res.json()) as { value: { uploadUrl: string; document: string } };
    return { uploadUrl: j.value.uploadUrl, urn: j.value.document };
  }

  async uploadBinary(uploadUrl: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.f(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: new Uint8Array(body),
    });
    if (!res.ok) throw await parseError(res);
  }

  async publish(accessToken: string, input: PublishInput): Promise<PublishResult> {
    const base = {
      author: input.author,
      commentary: input.commentary,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    let payload: Record<string, unknown> = base;
    if (input.kind === "image") {
      payload = { ...base, content: { media: { id: input.imageUrn, altText: input.altText } } };
    } else if (input.kind === "document") {
      payload = { ...base, content: { media: { id: input.documentUrn, title: input.title } } };
    }

    const res = await this.f(`${REST_BASE}/posts`, {
      method: "POST",
      headers: this.restHeaders(accessToken),
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    if (!res.ok) {
      let serviceErrorCode: number | null = null;
      try {
        const j = JSON.parse(raw) as { serviceErrorCode?: number };
        if (typeof j.serviceErrorCode === "number") serviceErrorCode = j.serviceErrorCode;
      } catch {
        // ignore
      }
      throw new LinkedInApiError({
        kind: classifyStatus(res.status),
        status: res.status,
        message: `LinkedIn ${res.status}: ${raw.slice(0, 200)}`,
        serviceErrorCode,
        responseSnippet: truncateResponse(raw),
      });
    }
    const urn = res.headers.get("x-restli-id");
    if (!urn) {
      logger.warn("linkedin.publish.no_urn_header", { rawSnippet: raw.slice(0, 200) });
      throw new LinkedInApiError({
        kind: "server",
        status: res.status,
        message: "En-tête x-restli-id absent de la réponse LinkedIn",
        responseSnippet: truncateResponse(raw),
      });
    }
    return { urn, url: urnToFeedUrl(urn), rawResponse: truncateResponse(raw), status: res.status };
  }

  async deletePost(accessToken: string, postUrn: string): Promise<void> {
    const res = await this.f(`${REST_BASE}/posts/${encodeURIComponent(postUrn)}`, {
      method: "DELETE",
      headers: this.restHeaders(accessToken),
    });
    if (!res.ok && res.status !== 204) throw await parseError(res);
  }

  async refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
    const e = env();
    if (!e.LINKEDIN_CLIENT_ID || !e.LINKEDIN_CLIENT_SECRET) {
      throw new LinkedInApiError({
        kind: "server",
        status: null,
        message: "LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET manquants",
      });
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: e.LINKEDIN_CLIENT_ID,
      client_secret: e.LINKEDIN_CLIENT_SECRET,
    });
    const res = await this.f(`${AUTH_BASE}/accessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw await parseError(res);
    const j = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      refresh_token_expires_in?: number;
    };
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? refreshToken,
      expiresInSec: j.expires_in,
      refreshExpiresInSec: j.refresh_token_expires_in ?? 60 * 60 * 24 * 365,
    };
  }
}
