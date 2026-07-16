import type { MailBlock } from "@/modules/mailing/domain/mail-blocks";

// CDC-02 §6.4 — composition d'un mail de campagne.
//
//   [ salutation automatique ]     ← verrouillée, générée par contact
//   [ corps rédigé à la main   ]   ← identique pour tous
//   [ blocs rigides choisis    ]   ← signature, footer… dans l'ordre choisi
//
// Format texte brut. Pas de HTML, pas de pixel, pas de lien raccourci (§10).
// La salutation vient en TÊTE, suivie d'une ligne vide, puis le corps, puis
// les blocs séparés par une ligne vide chacun.

export interface RenderCampaignInput {
  greeting: string;
  body: string;
  blocks: readonly MailBlock[];
}

export function renderCampaignBody(input: RenderCampaignInput): string {
  const parts: string[] = [];
  parts.push(input.greeting.trimEnd());
  parts.push(""); // ligne vide entre salutation et corps
  parts.push(input.body.trim());
  for (const b of input.blocks) {
    parts.push(""); // ligne vide entre chaque bloc
    parts.push(b.content.trim());
  }
  return parts.join("\n");
}
