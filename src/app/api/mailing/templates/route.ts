import { NextResponse } from "next/server";
import { mailTemplateInputSchema } from "@/modules/mailing/domain/mail-templates";
import { listTemplates, upsertTemplate } from "@/modules/mailing/repositories/mail-templates-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const templates = await listTemplates();
  return NextResponse.json({ templates });
}

export async function PUT(req: Request) {
  // Upsert par step ∈ {0,1,2}.
  const body = await req.json().catch(() => null);
  const parsed = mailTemplateInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  const template = await upsertTemplate(parsed.data);
  return NextResponse.json({ template });
}
