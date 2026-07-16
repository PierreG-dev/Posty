import { NextResponse } from "next/server";
import { defaultRegistry } from "@/modules/linkedin/visuals/registry";
import "@/modules/linkedin/visuals/register";
import { VISUAL_MODES, type VisualMode } from "@/modules/linkedin/domain/theme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?mode=image|carousel|none → liste des templates éligibles.
// L'UI (visual-editor client) l'appelle pour peupler son select.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "none";
  if (!(VISUAL_MODES as readonly string[]).includes(mode)) {
    return NextResponse.json({ error: `mode invalide : ${mode}` }, { status: 400 });
  }
  const templates = defaultRegistry().listTemplates(mode as VisualMode);
  return NextResponse.json({ templates });
}
