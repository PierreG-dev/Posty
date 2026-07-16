import { NextResponse } from "next/server";
import { themeInputSchema } from "@/modules/linkedin/domain/theme";
import { getTheme, updateTheme, deleteTheme } from "@/modules/linkedin/repositories/theme-repo";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const theme = await getTheme(id);
  if (!theme) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({ theme });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = themeInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  const theme = await updateTheme(id, parsed.data);
  if (!theme) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({ theme });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ok = await deleteTheme(id);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Introuvable" }, { status: 404 });
}
