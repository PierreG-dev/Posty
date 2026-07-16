import { logger } from "@/modules/shared/logger";
import { listBlocksByIds } from "@/modules/mailing/repositories/mail-blocks-repo";
import { getTemplateByStep } from "@/modules/mailing/repositories/mail-templates-repo";
import { getMailSettings } from "@/modules/mailing/repositories/mail-settings-repo";
import {
  enqueue,
  type EnqueueResult,
} from "@/modules/mailing/repositories/mail-queue-repo";
import { getOrCreateGreeting } from "@/modules/mailing/services/greeting";
import { GREETING_FALLBACK } from "@/modules/mailing/services/greeting";
import { renderSubject, renderTemplate } from "@/modules/mailing/domain/render-template";
import type { SequenceStep } from "@/modules/mailing/domain/mail-templates";
import type { TwentyCompany } from "@/modules/mailing/twenty/types";
import type { AnthropicClient } from "@/modules/shared/anthropic/client";

// CDC-02 §5.1 — enqueue() rend le mail à l'enfilement. Ce qui est en base est
// ce qui partira. La salutation est prise du meta (cache), le snapshot fige
// { name, email, greeting } dans l'entrée.

function priorityFromStep(step: SequenceStep): 1 | 2 {
  // §6.2 : relance (step 1|2) = 1, premier contact (step 0) = 2.
  return step === 0 ? 2 : 1;
}

export interface EnqueueSequenceOpts {
  anthropicClient?: AnthropicClient;
}

export type EnqueueSequenceResult =
  | { ok: true; duplicate: false; entryId: string }
  | { ok: true; duplicate: true }
  | { ok: false; reason: "no_email" | "no_template" | "render_error"; message: string };

/**
 * Enfile un mail de séquence pour un contact. Duplicate = abandon silencieux
 * (l'index unique { companyId, kind:'sequence', sequenceStep } garantit qu'un
 * contact ne peut pas recevoir deux fois le même step).
 *
 * Le rendu est fait ici, pas à l'envoi : le sujet et le corps stockés en base
 * sont exactement ce qui partira, même si les templates ou la salutation
 * changent entre-temps.
 */
export async function enqueueSequence(
  company: TwentyCompany,
  step: SequenceStep,
  opts: EnqueueSequenceOpts = {},
): Promise<EnqueueSequenceResult> {
  const email = company.contactEmail?.primaryEmail ?? null;
  if (!email) {
    return { ok: false, reason: "no_email", message: `contact ${company.id} sans email` };
  }

  const template = await getTemplateByStep(step);
  if (!template) {
    return { ok: false, reason: "no_template", message: `template step ${step} absent` };
  }

  const [settings, blocks] = await Promise.all([
    getMailSettings(),
    listBlocksByIds(template.blockIds),
  ]);
  void settings; // les paramètres SMTP/from ne sont pas nécessaires ici.

  const greeting = await safeGreeting(company, opts);
  const vars = { greeting };

  let subject: string;
  let body: string;
  try {
    subject = renderSubject(template.subject, vars);
    body = renderTemplate(template.body, vars, blocks);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("mailing.enqueue.render_error", { companyId: company.id, step, error: msg });
    return { ok: false, reason: "render_error", message: msg };
  }

  const threading =
    step === 0
      ? null
      : {
          inReplyTo: company.lastMessageId,
          references: company.messageReferences,
        };

  const res: EnqueueResult = await enqueue({
    companyId: company.id,
    kind: "sequence",
    sequenceStep: step,
    campaignId: null,
    priority: priorityFromStep(step),
    subject,
    body,
    snapshot: { name: company.name, email, greeting },
    threading,
  });

  if (res.duplicate) {
    logger.debug("mailing.enqueue.duplicate", { companyId: company.id, step });
    return { ok: true, duplicate: true };
  }
  logger.info("mailing.enqueue.ok", { companyId: company.id, step, entryId: res.entry._id });
  return { ok: true, duplicate: false, entryId: res.entry._id };
}

async function safeGreeting(
  company: TwentyCompany,
  opts: EnqueueSequenceOpts,
): Promise<string> {
  try {
    return await getOrCreateGreeting(company.id, company.name, { client: opts.anthropicClient });
  } catch (err) {
    logger.warn("mailing.enqueue.greeting_fallback", {
      companyId: company.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return GREETING_FALLBACK;
  }
}
