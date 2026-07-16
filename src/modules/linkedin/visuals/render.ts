import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { PDFDocument } from "pdf-lib";
import { loadFonts } from "./fonts";
import { tokens } from "@/modules/linkedin/design/tokens";
import { getTemplate, type SlideParams } from "./registry";
import "./register";

// CDC-01 §9 — pipeline de rendu.
// 1200×1200 (carré) : le plus performant en feed. Non paramétrable au lot 6.
export const CANVAS_SIZE = 1200;

/**
 * Rend un template en PNG via Satori → SVG → resvg.
 * Le schema du template a déjà validé `params` en amont (registry).
 */
export async function renderTemplateToPng(
  templateId: string,
  params: unknown,
): Promise<Buffer> {
  const template = getTemplate(templateId);
  if (!template) throw new Error(`Template inconnu : ${templateId}`);

  // Le validateur applique déjà le schema, mais on re-parse ici en filet.
  // C'est peu coûteux et ça empêche un caller négligent de crasher Satori.
  const parsed = template.schema.safeParse(params);
  if (!parsed.success) {
    throw new Error(
      `Params invalides pour ${templateId} : ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    );
  }

  const fonts = await loadFonts();
  const element = template.render(parsed.data, tokens);
  const svg = await satori(element, {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    fonts,
  });

  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: CANVAS_SIZE },
    background: tokens.colors.bg,
  })
    .render()
    .asPng();

  return Buffer.from(png);
}

/**
 * Rend N slides en un unique PDF (une page carrée par slide) via pdf-lib.
 * §9.4 : 3 à 10 slides — bornes appliquées par le validateur du contrat,
 * pas ici (cette fonction assemble ce qu'on lui donne).
 */
export async function renderCarouselToPdf(slides: SlideParams[]): Promise<Buffer> {
  if (slides.length === 0) throw new Error("Carrousel vide");

  const pdf = await PDFDocument.create();
  for (const slide of slides) {
    const png = await renderTemplateToPng(slide.templateId, slide.params);
    const embedded = await pdf.embedPng(png);
    const page = pdf.addPage([CANVAS_SIZE, CANVAS_SIZE]);
    page.drawImage(embedded, { x: 0, y: 0, width: CANVAS_SIZE, height: CANVAS_SIZE });
  }
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
