import { NextResponse } from "next/server";
import { duplicatePost } from "@/modules/linkedin/repositories/post-repo";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const post = await duplicatePost(id);
  if (!post) return NextResponse.json({ error: "Post source introuvable" }, { status: 404 });
  return NextResponse.json({ post }, { status: 201 });
}
