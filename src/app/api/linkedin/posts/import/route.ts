import { NextResponse } from "next/server";
import { z } from "zod";
import { parseTextImport, parseJsonImport } from "@/modules/linkedin/services/post-import";
import { importBatch } from "@/modules/linkedin/repositories/post-repo";
import { getTheme } from "@/modules/linkedin/repositories/theme-repo";
import { HASHTAG_RE } from "@/modules/linkedin/domain/theme";

export const runtime = "nodejs";

const schema = z.object({
  mode: z.enum(["text", "json"]),
  raw: z.string(),
  themeId: z.string().nullable().default(null),
  defaultHashtags: z.array(z.string().regex(HASHTAG_RE)).max(15).optional(),
  // Si true : on renvoie juste le résultat du parse, sans écrire en base.
  previewOnly: z.boolean().default(false),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload invalide", issues: parsed.error.issues }, { status: 400 });
  }

  const { mode, raw, themeId, defaultHashtags, previewOnly } = parsed.data;

  let result;
  if (mode === "text") {
    result = parseTextImport(raw);
  } else {
    // §8.8 rebranchement : si un thème est sélectionné, on applique le
    // validateur strict à chaque item du JSON.
    const theme = themeId ? await getTheme(themeId) : null;
    result = parseJsonImport(raw, theme ? { theme } : {});
  }

  if (previewOnly) {
    return NextResponse.json({
      drafts: result.drafts,
      errors: result.errors,
    });
  }

  // Si erreurs bloquantes, on refuse d'insérer.
  if (result.errors.length > 0) {
    return NextResponse.json({ error: "Import invalide", errors: result.errors, drafts: result.drafts }, { status: 400 });
  }

  const source = mode === "text" ? "manual" : "json-import";
  const created = await importBatch(result.drafts, {
    themeId,
    source,
    defaultHashtags,
  });

  return NextResponse.json({ created: created.length, posts: created }, { status: 201 });
}
