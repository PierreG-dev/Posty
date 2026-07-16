import { NextResponse } from "next/server";
import { getTheme } from "@/modules/linkedin/repositories/theme-repo";
import { listPosts } from "@/modules/linkedin/repositories/post-repo";
import {
  buildStandalonePrompt,
  buildContractFragment,
} from "@/modules/linkedin/services/prompt-builder";
import { defaultRegistry } from "@/modules/linkedin/visuals/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** §8.9 — renvoie le prompt copiable et le schéma seul, prêts pour le presse-papier. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const theme = await getTheme(id);
  if (!theme) return NextResponse.json({ error: "Thème introuvable" }, { status: 404 });

  const published = await listPosts({ status: "published", themeId: id });
  const recent = published.slice(0, 10);
  const registry = defaultRegistry();

  return NextResponse.json({
    full: buildStandalonePrompt(theme, recent, registry),
    schemaOnly: buildContractFragment(theme, registry),
  });
}
