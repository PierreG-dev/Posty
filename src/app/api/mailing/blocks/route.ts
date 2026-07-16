import { NextResponse } from "next/server";
import { mailBlockInputSchema } from "@/modules/mailing/domain/mail-blocks";
import { createBlock, listBlocks } from "@/modules/mailing/repositories/mail-blocks-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const blocks = await listBlocks();
  return NextResponse.json({ blocks });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = mailBlockInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  const block = await createBlock(parsed.data);
  return NextResponse.json({ block }, { status: 201 });
}
