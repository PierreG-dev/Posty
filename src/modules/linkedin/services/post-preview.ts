// Aperçu fidèle LinkedIn.
//
// LinkedIn tronque en feed autour de 140 caractères OU à la première ligne,
// selon ce qui vient en premier. La règle n'est PAS documentée officiellement
// et varie légèrement selon device ; on prend la borne prudente (140) et on
// coupe à la première rupture de ligne si elle intervient avant.
//
// C'est également ce que couvre la règle §8.4 CDC-01 :
//   « La ligne 1 fait ≤ 100 caractères et doit tenir seule :
//     c'est tout ce qui est visible avant le "…voir plus" ».

export const LINKEDIN_TRUNCATE_AT = 140;

export interface PreviewSegment {
  kind: "text" | "hashtag";
  text: string;
}

export interface PreviewResult {
  /** Segments visibles avant la troncature (avant "…voir plus"). */
  visible: PreviewSegment[];
  /** Segments masqués (visibles seulement si l'utilisateur clique). */
  hidden: PreviewSegment[];
  /** true si le contenu est effectivement tronqué. */
  truncated: boolean;
  /** Longueur totale du contenu (utilisé pour le compteur). */
  totalLength: number;
  /** Longueur consommée par la partie visible. */
  visibleLength: number;
  /** Position (index) où la troncature intervient dans le texte brut. */
  truncateAt: number;
}

/**
 * Découpe une chaîne en segments alternant texte simple et hashtags
 * (chaînes qui matchent /#[\w]+/). Utilisé pour rendre les hashtags en bleu.
 */
export function tokenize(text: string): PreviewSegment[] {
  const segments: PreviewSegment[] = [];
  const re = /#[A-Za-z0-9_]+/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) segments.push({ kind: "text", text: text.slice(lastIndex, m.index) });
    segments.push({ kind: "hashtag", text: m[0] });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) segments.push({ kind: "text", text: text.slice(lastIndex) });
  return segments;
}

/**
 * Calcule l'aperçu.
 * - Cherche la première rupture de ligne dans les LINKEDIN_TRUNCATE_AT premiers caractères.
 * - Si trouvée : coupe à cet endroit.
 * - Sinon : coupe à LINKEDIN_TRUNCATE_AT (si le contenu est plus long).
 * - Sinon : pas de troncature.
 */
export function computePreview(rawContent: string): PreviewResult {
  const text = rawContent;
  const totalLength = text.length;

  // Rupture de ligne dans la zone visible ?
  const firstNewline = text.indexOf("\n");
  const isTruncatedByNewline = firstNewline >= 0 && firstNewline < LINKEDIN_TRUNCATE_AT && firstNewline < totalLength - 1;
  const isTruncatedByLength = totalLength > LINKEDIN_TRUNCATE_AT;

  let cut: number;
  if (isTruncatedByNewline) {
    cut = firstNewline;
  } else if (isTruncatedByLength) {
    // On ne coupe pas au milieu d'un mot si on peut l'éviter : recule au dernier espace
    // dans les 20 caractères précédents, sinon on coupe pile à la limite.
    const soft = text.lastIndexOf(" ", LINKEDIN_TRUNCATE_AT);
    cut = soft >= LINKEDIN_TRUNCATE_AT - 20 ? soft : LINKEDIN_TRUNCATE_AT;
  } else {
    cut = totalLength;
  }

  const truncated = cut < totalLength;
  const visibleText = text.slice(0, cut);
  const hiddenText = truncated ? text.slice(cut) : "";

  return {
    visible: tokenize(visibleText),
    hidden: tokenize(hiddenText),
    truncated,
    totalLength,
    visibleLength: visibleText.length,
    truncateAt: cut,
  };
}
