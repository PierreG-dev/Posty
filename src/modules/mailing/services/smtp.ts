import { randomUUID } from "node:crypto";
import { logger } from "@/modules/shared/logger";
import type { MailSettings } from "@/modules/mailing/domain/mail-settings";

// Client SMTP isolé et mockable. L'interface est le contrat que testent la
// boucle d'envoi et les tests unitaires ; l'implémentation nodemailer vit
// dans createNodemailerClient(), chargée dynamiquement pour que le module ne
// s'écroule pas si `nodemailer` n'est pas installé côté test.

export interface SendMailInput {
  from: string;
  to: string;
  subject: string;
  text: string; // TEXTE BRUT — §10 : jamais de HTML.
  bcc?: string | null;
  headers?: Record<string, string>;
  // Threading — §6.5. Les headers In-Reply-To / References sont
  // construits par l'appelant à partir de `snapshot`/`threading`.
}

export interface SendMailResult {
  messageId: string;
}

export interface SmtpClient {
  send(input: SendMailInput): Promise<SendMailResult>;
}

/**
 * Fabrique un client nodemailer paramétré par les settings. Chargé
 * dynamiquement pour rester importable dans un contexte de test (les tests
 * SMTP passent un mock explicite).
 */
export async function createNodemailerClient(settings: MailSettings): Promise<SmtpClient> {
  // Import dynamique — évite de tirer nodemailer dans un test unitaire du
  // send-tick qui passe un mock explicite.
  const mod = await import("nodemailer");
  const transporter = mod.createTransport({
    host: settings.smtp.host,
    port: settings.smtp.port,
    secure: settings.smtp.secure,
    auth:
      settings.smtp.user || settings.smtp.pass
        ? { user: settings.smtp.user, pass: settings.smtp.pass }
        : undefined,
  });

  return {
    async send(input) {
      const info = await transporter.sendMail({
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        bcc: input.bcc ?? undefined,
        headers: input.headers,
      });
      const messageId = String(info?.messageId ?? "").trim();
      if (!messageId) {
        // Pas de Message-ID → le suivi (bounces, réponses) sera cassé.
        throw new Error("SMTP: pas de Message-ID retourné");
      }
      return { messageId };
    },
  };
}

/**
 * Client factice pour dryRun. Il n'ouvre aucune socket ; il retourne un
 * messageId « dry-{uuid} » qu'on retrouvera tel quel dans mail_log.
 */
export function createDryRunClient(): SmtpClient {
  return {
    async send(input) {
      const id = `dry-${randomUUID()}@posty.local`;
      logger.info("mailing.smtp.dry", {
        to: input.to,
        subject: input.subject.slice(0, 80),
        bytes: Buffer.byteLength(input.text, "utf8"),
      });
      return { messageId: id };
    },
  };
}
