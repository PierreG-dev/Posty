import { z } from "zod";
import { postDraftSchema, type PostDraft, POST_CONTENT_MAX } from "@/modules/linkedin/domain/post";
import type { Theme } from "@/modules/linkedin/domain/theme";
import { validateGeneratedPost } from "@/modules/linkedin/domain/validate-generated-post";

export interface ImportItemError {
  index: number;
  message: string;
}

export interface ImportResult {
  drafts: PostDraft[];
  errors: ImportItemError[];
}

/**
 * Import TEXTE — format n8n actuel.
 * Blocs séparés par une ligne `---` isolée. On tolère :
 *   - whitespace autour de ---
 *   - séparateurs consécutifs (blocs vides ignorés)
 *   - leading/trailing ---
 * On ne parse PAS les hashtags depuis le texte : ils vivent dans le formulaire.
 */
export function parseTextImport(raw: string): ImportResult {
  const errors: ImportItemError[] = [];
  const drafts: PostDraft[] = [];
  if (!raw || raw.trim().length === 0) return { drafts, errors };

  // Découpage : une ligne contenant uniquement ---, éventuellement précédée/suivie d'espaces.
  const blocks = raw
    .split(/^[ \t]*---[ \t]*$/m)
    .map((b) => b.replace(/^\s+|\s+$/g, ""))
    .filter((b) => b.length > 0);

  blocks.forEach((content, i) => {
    if (content.length > POST_CONTENT_MAX) {
      errors.push({ index: i, message: `Bloc ${i + 1} : ${content.length} caractères (> ${POST_CONTENT_MAX})` });
      return;
    }
    drafts.push({
      content,
      hashtags: [],
      firstComment: null,
      altText: "",
    });
  });

  return { drafts, errors };
}

const jsonItemSchema = postDraftSchema;
const jsonPayloadSchema = z.union([jsonItemSchema, z.array(jsonItemSchema)]);

/**
 * Import JSON — un objet ou un tableau d'objets conformes à `postDraftSchema`.
 * Si `opts.theme` est fourni : chaque item est aussi validé par le validateur
 * strict §8.8 (`validateGeneratedPost`). C'est ce qui garantit qu'un JSON
 * généré par un chat externe et collé ici passe les mêmes règles que la
 * génération API.
 */
export function parseJsonImport(
  raw: string,
  opts: { theme?: Theme } = {},
): ImportResult {
  const errors: ImportItemError[] = [];
  const drafts: PostDraft[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    errors.push({ index: -1, message: `JSON invalide : ${err instanceof Error ? err.message : String(err)}` });
    return { drafts, errors };
  }

  const result = jsonPayloadSchema.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const first = issue.path[0];
      const idx = typeof first === "number" ? first : -1;
      const rest = issue.path.slice(idx === -1 ? 0 : 1).join(".");
      errors.push({
        index: idx,
        message: rest ? `${rest} : ${issue.message}` : issue.message,
      });
    }
    return { drafts, errors };
  }

  const items = Array.isArray(result.data) ? result.data : [result.data];

  items.forEach((it, i) => {
    if (opts.theme) {
      // Reconstruit un candidat au format §8.7 depuis le draft.
      const candidate = {
        content: it.content,
        hashtags: it.hashtags,
        firstComment: it.firstComment,
        visual: null,
        carousel: null,
        altText: it.altText,
      };
      const check = validateGeneratedPost(candidate, opts.theme);
      if (!check.ok) {
        for (const e of check.errors) {
          errors.push({ index: i, message: `${e.path} : ${e.message}` });
        }
        return;
      }
    }
    drafts.push(it);
  });

  return { drafts, errors };
}
