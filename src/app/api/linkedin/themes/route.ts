import { NextResponse } from "next/server";
import { themeInputSchema } from "@/modules/linkedin/domain/theme";
import { createTheme, listThemes } from "@/modules/linkedin/repositories/theme-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "true";
  const themes = await listThemes({ includeArchived });
  return NextResponse.json({ themes });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = themeInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  const theme = await createTheme(parsed.data);
  return NextResponse.json({ theme }, { status: 201 });
}
