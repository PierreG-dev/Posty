import { NextResponse } from "next/server";
import { z } from "zod";
import { reorderQueue } from "@/modules/linkedin/repositories/post-repo";

export const runtime = "nodejs";

const schema = z.object({
  themeId: z.string().nullable(),
  orderedIds: z.array(z.string().min(1)),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  const r = await reorderQueue(parsed.data.themeId, parsed.data.orderedIds);
  if (!r.ok) return NextResponse.json({ error: r.reason ?? "reorder refusé" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
