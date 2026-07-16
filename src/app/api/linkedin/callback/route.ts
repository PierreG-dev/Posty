import { NextResponse } from "next/server";
import { env } from "@/modules/shared/env";
import { logger } from "@/modules/shared/logger";
import { PostsApiClient } from "@/modules/linkedin/linkedin-api";
import { saveLinkedInCredentials } from "@/modules/shared/settings/repo";
import { OAUTH_STATE_COOKIE } from "@/modules/linkedin/linkedin-api/oauth-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  scope?: string;
}

/**
 * Callback OAuth (§10.2). Vérifie `state`, échange le code, résout l'URN via
 * `/v2/userinfo`, chiffre et stocke les tokens.
 * Route publique (voir `middleware.ts`) — la sécurité repose sur `state`.
 */
export async function GET(req: Request): Promise<Response> {
  const e = env();
  if (!e.LINKEDIN_CLIENT_ID || !e.LINKEDIN_CLIENT_SECRET || !e.LINKEDIN_REDIRECT_URI) {
    return NextResponse.json({ error: "Configuration LinkedIn incomplète" }, { status: 503 });
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    logger.warn("linkedin.oauth.remote_error", { error: oauthError });
    return NextResponse.redirect(new URL("/settings?linkedin=error", e.APP_URL));
  }
  if (!code || !state) return NextResponse.json({ error: "code/state manquants" }, { status: 400 });

  const cookieHeader = req.headers.get("cookie") ?? "";
  const expectedState = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.slice(OAUTH_STATE_COOKIE.length + 1);
  if (!expectedState || expectedState !== state) {
    logger.warn("linkedin.oauth.state_mismatch");
    return NextResponse.json({ error: "state invalide" }, { status: 400 });
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: e.LINKEDIN_REDIRECT_URI,
    client_id: e.LINKEDIN_CLIENT_ID,
    client_secret: e.LINKEDIN_CLIENT_SECRET,
  });
  const tokRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokRes.ok) {
    const text = await tokRes.text().catch(() => "");
    logger.error("linkedin.oauth.token_exchange_failed", { status: tokRes.status, body: text.slice(0, 500) });
    return NextResponse.json({ error: "Échec de l'échange du code" }, { status: 502 });
  }
  const tok = (await tokRes.json()) as TokenResponse;

  const client = new PostsApiClient();
  const info = await client.getUserInfo(tok.access_token);
  const authorUrn = `urn:li:person:${info.sub}`;

  const now = Date.now();
  await saveLinkedInCredentials({
    authorUrn,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: new Date(now + tok.expires_in * 1000),
    refreshExpiresAt: new Date(now + (tok.refresh_token_expires_in ?? 60 * 60 * 24 * 365) * 1000),
  });

  const redirect = NextResponse.redirect(new URL("/settings?linkedin=ok", e.APP_URL));
  redirect.cookies.delete(OAUTH_STATE_COOKIE);
  return redirect;
}
