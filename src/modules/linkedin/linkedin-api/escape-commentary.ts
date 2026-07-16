// CDC-01 §10.5 + docs/spike-linkedin.md — décision « échapper les 13 ».
// Le spike n'a pas obtenu de « invalid character » propre : il a obtenu des
// « duplicate content » suspects sur `) ] } |` non-échappés, ce qui suggère
// que LinkedIn parse certains caractères comme du markup (Little Text).
// Coût nul, risque à ne pas échapper non nul → on échappe systématiquement.
export const RESERVED_COMMENTARY_CHARS = [
  "(", ")", "[", "]", "{", "}", "<", ">", "@", "|", "~", "_", "*",
] as const;

const RESERVED_SET = new Set<string>(RESERVED_COMMENTARY_CHARS);

/**
 * Préfixe chaque caractère réservé d'un `\`, sauf s'il l'est déjà.
 * Idempotent : `escape(escape(x)) === escape(x)`.
 */
export function escapeCommentary(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (RESERVED_SET.has(ch)) {
      const prev = i > 0 ? text[i - 1] : undefined;
      if (prev !== "\\") out += "\\";
    }
    out += ch;
  }
  return out;
}
