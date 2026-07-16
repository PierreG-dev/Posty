import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/modules/shared/env";

export const SESSION_COOKIE = "posty_session";
const SESSION_TTL_DAYS = 7;

interface Payload {
  sub: "owner";
  iat: number;
  exp: number;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env().SESSION_SECRET);
}

export async function issueSessionCookie(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_DAYS * 24 * 60 * 60;
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject("owner")
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret());

  const store = await cookies();
  store.set({
    name: SESSION_COOKIE,
    value: jwt,
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<Payload | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, secret(), { algorithms: ["HS256"] });
    if (payload.sub !== "owner" || typeof payload.iat !== "number" || typeof payload.exp !== "number") {
      return null;
    }
    return { sub: "owner", iat: payload.iat, exp: payload.exp };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Payload> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Utilisé par le middleware (Edge) : vérifie un token brut sans passer par cookies(). */
export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}
