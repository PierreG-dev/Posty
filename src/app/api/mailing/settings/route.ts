import { NextResponse } from "next/server";
import { mailSettingsInputSchema } from "@/modules/mailing/domain/mail-settings";
import { getMailSettings, updateMailSettings } from "@/modules/mailing/repositories/mail-settings-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getMailSettings();
  return NextResponse.json({ settings });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = mailSettingsInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  const settings = await updateMailSettings(parsed.data);
  return NextResponse.json({ settings });
}
