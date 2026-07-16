import { NextResponse } from "next/server";
import { z } from "zod";
import { renderTemplateToPng, renderCarouselToPdf } from "@/modules/linkedin/visuals/render";
import { logger } from "@/modules/shared/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CDC-01 §9.5 — rendu à la volée, NON persisté.
// L'UI l'utilise pour prévisualiser et régénérer avant de figer un visuel.

const previewSchema = z.union([
  z.object({
    kind: z.literal("image"),
    templateId: z.string().min(1),
    params: z.unknown(),
  }),
  z.object({
    kind: z.literal("carousel"),
    slides: z
      .array(
        z.object({
          templateId: z.string().min(1),
          params: z.unknown().transform((v) => v ?? null),
        }),
      )
      .min(1)
      .max(10),
  }),
]);

export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload invalide", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    if (parsed.data.kind === "image") {
      const png = await renderTemplateToPng(parsed.data.templateId, parsed.data.params);
      return new Response(new Uint8Array(png), {
        status: 200,
        headers: {
          "content-type": "image/png",
          "cache-control": "no-store",
        },
      });
    }
    const pdf = await renderCarouselToPdf(
      parsed.data.slides.map((s) => ({ templateId: s.templateId, params: s.params ?? null })),
    );
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("api.linkedin.visuals.preview.failed", { message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
