import { NextResponse } from "next/server";
import { z } from "zod";
import { twentyFromEnv } from "@/modules/mailing/twenty";
import { setManualGreeting, setGeneratedGreeting } from "@/modules/mailing/repositories/company-meta-repo";
import { generateGreeting } from "@/modules/mailing/services/greeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const putBody = z.object({ greeting: z.string().trim().min(1).max(300) });

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = putBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }
  const meta = await setManualGreeting(id, parsed.data.greeting);
  return NextResponse.json({ meta });
}

/** Régénère la salutation via l'IA — écrase, sauf si `greetingEditedByHuman`. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const client = twentyFromEnv();
  if (!client) {
    return NextResponse.json(
      { error: "TWENTY_API_URL ou TWENTY_API_KEY manquant dans .env" },
      { status: 503 },
    );
  }
  const company = await client.getCompany(id);
  if (!company) return NextResponse.json({ error: "Contact introuvable" }, { status: 404 });
  const greeting = await generateGreeting(company.name);
  const meta = await setGeneratedGreeting(id, greeting);
  return NextResponse.json({ meta, greeting });
}
