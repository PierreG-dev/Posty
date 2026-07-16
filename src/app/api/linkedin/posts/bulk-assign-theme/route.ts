import { NextResponse } from "next/server";
import { z } from "zod";
import { bulkAssignTheme } from "@/modules/linkedin/repositories/post-repo";

export const runtime = "nodejs";

const schema = z.object({
  postIds: z.array(z.string().min(1)).min(1),
  themeId: z.string().nullable(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  const modified = await bulkAssignTheme(parsed.data.postIds, parsed.data.themeId);
  return NextResponse.json({ modified });
}
