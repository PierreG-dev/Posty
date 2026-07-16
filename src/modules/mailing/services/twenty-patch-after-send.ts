import { DateTime } from "luxon";
import type { TwentyClient, TwentyCompany, TwentyCompanyPatch } from "@/modules/mailing/twenty/types";
import type { MailSettings } from "@/modules/mailing/domain/mail-settings";

// §6.2 & §3.1 — après un envoi de séquence, Posty PATCH Twenty EXACTEMENT sur
// les champs déjà écrits par n8n. Aucun champ nouveau. C'est ce qui permet le
// retour arrière n8n → Posty et vice-versa.

export interface AfterSendContext {
  company: TwentyCompany;
  step: 0 | 1 | 2;
  messageId: string;
  sentAt: Date;
  settings: MailSettings;
}

/**
 * Construit et applique le patch Twenty après un envoi de séquence réussi.
 * - `followupCount` +1
 * - `lastContactedAt` = maintenant (UTC ISO)
 * - `lastMessageId` = <Message-ID>
 * - `messageReferences` = concat des Message-Id du fil (préfixe existant)
 * - `nextFollowupAt` = maintenant + delays[step+1] jours si next step existe,
 *   sinon on laisse `nextFollowupAt` inchangé (ne pas transmettre le champ).
 * - `toContact` : passe à `false` sur step 0 → 1 → 2 (le contact est en cours
 *   de traitement, la sortie de l'entonnoir).
 * En dryRun, `applyTwentyAfterSend` n'est pas appelée (§plan) — le send-tick
 * skip la partie Twenty.
 */
export function buildAfterSendPatch(ctx: AfterSendContext): TwentyCompanyPatch {
  const nextStep = ctx.step + 1;
  const delays = ctx.settings.sequence.delays;
  const patch: TwentyCompanyPatch = {
    followupCount: (ctx.company.followupCount ?? 0) + 1,
    lastContactedAt: ctx.sentAt.toISOString(),
    lastMessageId: ctx.messageId,
    messageReferences: joinReferences(ctx.company.messageReferences, ctx.messageId),
    toContact: false,
  };
  if (nextStep <= 2 && delays[nextStep] != null) {
    const nextAt = DateTime.fromJSDate(ctx.sentAt).plus({ days: delays[nextStep] });
    patch.nextFollowupAt = nextAt.toUTC().toISO() ?? undefined;
  }
  return patch;
}

export async function applyTwentyAfterSend(
  twenty: TwentyClient,
  ctx: AfterSendContext,
): Promise<void> {
  const patch = buildAfterSendPatch(ctx);
  await twenty.patchCompany(ctx.company.id, patch);
}

/** Concatène le Message-ID au champ `messageReferences` existant. */
function joinReferences(existing: string | null, messageId: string): string {
  const previous = (existing ?? "").trim();
  const clean = messageId.trim();
  if (!previous) return clean;
  if (previous.includes(clean)) return previous;
  return `${previous} ${clean}`.trim();
}
