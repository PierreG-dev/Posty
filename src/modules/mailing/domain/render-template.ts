// Fonction pure : substitue {{GREETING}} et {{BLOCK:<name>}} dans le corps
// d'un template. Utilisée à l'enfilement (§5.1) — le rendu est FIGÉ à ce
// moment-là et stocké dans mail_queue.snapshot pour que le mail vu dans l'UI
// soit exactement celui qui partira.

import type { MailBlock } from "./mail-blocks";

export interface RenderVars {
  greeting: string;
  // extensible : d'autres variables pourront apparaître (nom du destinataire…)
  // sans casser les templates existants — les tokens inconnus lèvent.
}

export class TemplateRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateRenderError";
  }
}

/**
 * Rend un template. Toute variable ou tout bloc référencé mais introuvable
 * lève une TemplateRenderError — mieux vaut planter à l'enfilement (loggué,
 * notifié) qu'envoyer un mail avec des `{{BLOCK:signature}}` en clair.
 */
export function renderTemplate(
  body: string,
  vars: RenderVars,
  blocks: readonly MailBlock[],
): string {
  const blockByName = new Map(blocks.map((b) => [b.name, b]));

  return body.replace(/\{\{\s*([A-Z_]+)(?::([^}]+))?\s*\}\}/g, (_match, token: string, arg?: string) => {
    if (token === "GREETING") {
      return vars.greeting;
    }
    if (token === "BLOCK") {
      const name = (arg ?? "").trim();
      if (!name) throw new TemplateRenderError("{{BLOCK:...}} sans nom");
      const b = blockByName.get(name);
      if (!b) throw new TemplateRenderError(`Bloc introuvable : "${name}"`);
      return b.content;
    }
    throw new TemplateRenderError(`Variable inconnue : {{${token}}}`);
  });
}

/**
 * Rend un sujet — pareil, mais les blocs n'ont pas de sens dans un sujet, on
 * les rejette explicitement.
 */
export function renderSubject(subject: string, vars: RenderVars): string {
  return subject.replace(/\{\{\s*([A-Z_]+)(?::([^}]+))?\s*\}\}/g, (_match, token: string) => {
    if (token === "GREETING") return vars.greeting;
    if (token === "BLOCK") throw new TemplateRenderError("{{BLOCK:...}} interdit dans un sujet");
    throw new TemplateRenderError(`Variable inconnue : {{${token}}}`);
  });
}
