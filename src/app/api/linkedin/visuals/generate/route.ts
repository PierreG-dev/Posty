import { NextResponse } from "next/server";
import { z } from "zod";
import {
  renderTemplateToPng,
  renderCarouselToPdf,
  CANVAS_SIZE,
} from "@/modules/linkedin/visuals/render";
import { saveGeneratedPng, saveGeneratedPdf } from "@/modules/linkedin/repositories/asset-repo";
import { logger } from "@/modules/shared/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CDC-01 §9 — génération + persistance. Retourne l'assetId, à câbler ensuite
// sur `post.media.assetId` par l'éditeur.

const generateSchema = z.union([
  z.object({
    kind: z.literal("image"),
    templateId: z.string().min(1),
    params: z.unknown(),
  }),
  z.object({
    kind: z.literal("carousel"),
    slides: z
      .array(z.object({ templateId: z.string().min(1), params: z.unknown() }))
      .min(3)
      .max(10),
  }),
]);

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload invalide", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    if (parsed.data.kind === "image") {
      const png = await renderTemplateToPng(parsed.data.templateId, parsed.data.params);
      const asset = await saveGeneratedPng(
        png,
        { templateId: parsed.data.templateId, params: parsed.data.params },
        { width: CANVAS_SIZE, height: CANVAS_SIZE },
      );
      return NextResponse.json({ assetId: asset._id, kind: "image" });
    }
    const pdf = await renderCarouselToPdf(
      parsed.data.slides.map((s) => ({ templateId: s.templateId, params: s.params ?? null })),
    );
    const asset = await saveGeneratedPdf(pdf, {
      templateId: "carousel",
      params: { slides: parsed.data.slides },
    });
    return NextResponse.json({ assetId: asset._id, kind: "document" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("api.linkedin.visuals.generate.failed", { message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
