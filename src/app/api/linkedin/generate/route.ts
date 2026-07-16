import { NextResponse } from "next/server";
import { z } from "zod";
import { generatePost } from "@/modules/linkedin/services/generator";
import { logger } from "@/modules/shared/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  themeId: z.string().min(1),
  variants: z.union([z.literal(1), z.literal(3)]).default(3),
  persist: z.boolean().default(false),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const result = await generatePost(parsed.data.themeId, {
      variants: parsed.data.variants,
      persist: parsed.data.persist,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("api.linkedin.generate.failed", { message });
    // 503 pour ANTHROPIC_API_KEY manquant, 404 pour thème introuvable, 400 sinon.
    const status = /ANTHROPIC_API_KEY/i.test(message)
      ? 503
      : /introuvable/i.test(message)
        ? 404
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
