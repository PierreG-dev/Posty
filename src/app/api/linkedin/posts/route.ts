import { NextResponse } from "next/server";
import { postInputSchema, POST_STATUSES, type PostStatus } from "@/modules/linkedin/domain/post";
import { createPost, listPosts, countByStatus } from "@/modules/linkedin/repositories/post-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const statusRaw = url.searchParams.get("status");
  const themeId = url.searchParams.get("themeId");
  const withCounts = url.searchParams.get("counts") === "true";

  const status = statusRaw && (POST_STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as PostStatus) : undefined;

  const posts = await listPosts({
    status,
    themeId: themeId === "null" ? null : themeId ?? undefined,
  });

  if (withCounts) {
    const counts = await countByStatus();
    return NextResponse.json({ posts, counts });
  }
  return NextResponse.json({ posts });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = postInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  const post = await createPost(parsed.data);
  return NextResponse.json({ post }, { status: 201 });
}
