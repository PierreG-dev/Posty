import { NextResponse } from "next/server";
import { postInputSchema } from "@/modules/linkedin/domain/post";
import { getPost, updatePost, deletePost } from "@/modules/linkedin/repositories/post-repo";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const post = await getPost(id);
  if (!post) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({ post });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = postInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  const post = await updatePost(id, parsed.data);
  if (!post) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({ post });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ok = await deletePost(id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Introuvable" }, { status: 404 });
}
