import { NextResponse } from "next/server";
import { generatePost } from "@/modules/linkedin/services/generator";
import { logger } from "@/modules/shared/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** §12 — bouton « Tester la génération » : 1 variante, ne persiste rien. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const result = await generatePost(id, { variants: 1, persist: false });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("api.linkedin.test_generation.failed", { themeId: id, message });
    const status = /ANTHROPIC_API_KEY/i.test(message) ? 503 : /introuvable/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
