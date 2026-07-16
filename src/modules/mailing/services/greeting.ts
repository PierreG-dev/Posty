import { logger } from "@/modules/shared/logger";
import { getSharedAnthropicClient, type AnthropicClient } from "@/modules/shared/anthropic/client";
import { getMailSettings } from "@/modules/mailing/repositories/mail-settings-repo";
import { getMeta, setGeneratedGreeting } from "@/modules/mailing/repositories/company-meta-repo";
import { twentyFromEnv } from "@/modules/mailing/twenty";
import type { TwentyClient } from "@/modules/mailing/twenty";

// CDC-02 §6.1 — la salutation est calculée UNE SEULE FOIS par contact,
// stockée dans company_meta.greeting, éditable à la main. En cas d'échec :
// fallback silencieux sur "Bonjour," — jamais bloquant, jamais throw.

export const GREETING_FALLBACK = "Bonjour,";

const MAX_NAME_LEN = 200;

function sanitizeGreeting(raw: string): string {
  // Le modèle est instruit de renvoyer UNE ligne, terminée par une virgule.
  // On garde la première ligne non vide, on la trime, on force la virgule
  // finale si absente.
  const first = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  if (!first) return GREETING_FALLBACK;
  const noQuotes = first.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!noQuotes) return GREETING_FALLBACK;
  return noQuotes.endsWith(",") ? noQuotes : `${noQuotes},`;
}

export interface GenerateGreetingOpts {
  client?: AnthropicClient;
}

/**
 * Appelle Claude pour générer la salutation. NE THROW JAMAIS : en cas
 * d'erreur (clé absente, réseau, sortie vide), renvoie `GREETING_FALLBACK`.
 */
export async function generateGreeting(companyName: string, opts: GenerateGreetingOpts = {}): Promise<string> {
  const name = (companyName ?? "").trim().slice(0, MAX_NAME_LEN);
  if (!name) return GREETING_FALLBACK;

  try {
    const settings = await getMailSettings();
    const client = opts.client ?? getSharedAnthropicClient();
    const res = await client.call({
      system: settings.greeting.systemPrompt,
      user: name,
      model: settings.greeting.model,
      temperature: settings.greeting.temperature,
      maxTokens: settings.greeting.maxTokens,
    });
    const cleaned = sanitizeGreeting(res.text);
    return cleaned;
  } catch (err) {
    logger.warn("mailing.greeting.fallback", {
      companyName: name,
      error: err instanceof Error ? err.message : String(err),
    });
    return GREETING_FALLBACK;
  }
}

/**
 * Retourne la salutation existante en base, ou la génère et la persiste.
 * Ne rappelle pas l'API si `greeting` est déjà stockée (même à `null` non —
 * on distingue « pas calculée » (pas de doc / null) de « calculée = fallback »).
 * Décision : on stocke même le fallback pour ne pas rappeler l'API à chaque tick.
 */
export async function getOrCreateGreeting(
  companyId: string,
  companyName: string,
  opts: GenerateGreetingOpts = {},
): Promise<string> {
  const existing = await getMeta(companyId);
  if (existing?.greeting) return existing.greeting;
  const generated = await generateGreeting(companyName, opts);
  await setGeneratedGreeting(companyId, generated);
  return generated;
}

export interface BackfillOpts {
  twenty?: TwentyClient;
  client?: AnthropicClient;
  limit?: number;
}

export interface BackfillResult {
  scanned: number;
  filled: number;
  skipped: number;
  errors: number;
}

/**
 * Job de rattrapage : remplit les salutations manquantes pour les companies
 * Twenty éligibles à un envoi (`isAutoHandled=true`). Explicitement hors
 * boucle d'envoi (§6.1). Aucune écriture Twenty.
 */
export async function backfillGreetings(opts: BackfillOpts = {}): Promise<BackfillResult> {
  const twenty = opts.twenty ?? twentyFromEnv();
  if (!twenty) {
    logger.warn("mailing.greeting.backfill.no-twenty");
    return { scanned: 0, filled: 0, skipped: 0, errors: 0 };
  }
  const limit = opts.limit ?? 200;
  const { items } = await twenty.listCompanies({ isAutoHandled: true, limit });
  let filled = 0;
  let skipped = 0;
  let errors = 0;
  for (const c of items) {
    try {
      const meta = await getMeta(c.id);
      if (meta?.greeting) {
        skipped++;
        continue;
      }
      const g = await generateGreeting(c.name, opts);
      await setGeneratedGreeting(c.id, g);
      filled++;
    } catch (err) {
      errors++;
      logger.warn("mailing.greeting.backfill.error", {
        companyId: c.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { scanned: items.length, filled, skipped, errors };
}
