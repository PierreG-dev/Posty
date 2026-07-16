import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderCarouselToPdf } from "@/modules/linkedin/visuals/render";

describe("carrousel — assemblage PDF", () => {
  it("3 slides → PDF de 3 pages, chaque page 1200×1200", async () => {
    const pdf = await renderCarouselToPdf([
      { templateId: "cover", params: { title: "Le titre 1", subtitle: "sub", badge: "carrousel" } },
      { templateId: "tip-card", params: { title: "Slide 2", bullets: ["a", "b", "c"] } },
      { templateId: "cta", params: { headline: "Prêt ?", action: "Passe à l'action" } },
    ]);
    // Signature PDF : "%PDF-"
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(3);
    const [p0] = doc.getPages();
    expect(Math.round(p0!.getWidth())).toBe(1200);
    expect(Math.round(p0!.getHeight())).toBe(1200);
  }, 30_000);
});
