import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/modules/shared/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
export const OAUTH_STATE_COOKIE = "linkedin_oauth_state";

/**
 * Démarre le flow OAuth LinkedIn. Génère un `state` aléatoire posé en cookie
 * httpOnly (vérifié par le callback pour bloquer les CSRF).
 * Scopes : `openid profile w_member_social` (CDC-01 §10.1).
 */
export async function GET(): Promise<Response> {
  const e = env();
  if (!e.LINKEDIN_CLIENT_ID || !e.LINKEDIN_REDIRECT_URI) {
    return NextResponse.json(
      { error: "LINKEDIN_CLIENT_ID / LINKEDIN_REDIRECT_URI manquants dans l'env" },
      { status: 503 },
    );
  }
  const state = randomBytes(24).toString("base64url");
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", e.LINKEDIN_CLIENT_ID);
  url.searchParams.set("redirect_uri", e.LINKEDIN_REDIRECT_URI);
  url.searchParams.set("scope", "openid profile w_member_social");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: e.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
