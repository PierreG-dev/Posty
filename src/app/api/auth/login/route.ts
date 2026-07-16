import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassword } from "@/modules/shared/auth/password";
import { issueSessionCookie } from "@/modules/shared/auth/session";
import { checkRateLimit } from "@/modules/shared/auth/rate-limit";
import { logger } from "@/modules/shared/logger";

const schema = z.object({ password: z.string().min(1) });

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";

  const rl = checkRateLimit(`login:${ip}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Trop de tentatives. Réessaie dans ${rl.retryAfterSec}s.` },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const ok = await verifyPassword(parsed.data.password);
  if (!ok) {
    logger.warn("auth.login.failed", { ip });
    return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
  }

  await issueSessionCookie();
  logger.info("auth.login.ok", { ip });
  return NextResponse.json({ ok: true });
}
