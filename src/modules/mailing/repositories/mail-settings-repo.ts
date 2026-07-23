import { connectDb } from "@/modules/shared/db/mongoose";
import { env } from "@/modules/shared/env";
import {
  mailSettingsInputSchema,
  type MailSettings,
  type MailSettingsInput,
} from "@/modules/mailing/domain/mail-settings";
import { MailSettingsModel, MAIL_SETTINGS_ID, type MailSettingsDoc } from "./mail-settings-model";

function toDomain(doc: MailSettingsDoc): MailSettings {
  return {
    _id: "singleton",
    sendDays: doc.sendDays.map((d) => ({
      dayOfWeek: (d.dayOfWeek ?? 1) as number,
      time: (d.time ?? "00:00") as string,
    })),
    dailyCap: doc.dailyCap,
    jitter: {
      minSeconds: (doc.jitter.minSeconds ?? 45) as number,
      maxSeconds: (doc.jitter.maxSeconds ?? 180) as number,
    },
    sequence: {
      delays: (doc.sequence.delays ?? []).map((n) => (n ?? 0) as number),
      clientRelanceDays: doc.sequence.clientRelanceDays,
    },
    smtp: {
      host: doc.smtp.host,
      port: doc.smtp.port,
      secure: doc.smtp.secure,
      user: doc.smtp.user,
      pass: doc.smtp.pass,
      from: doc.smtp.from,
    },
    imap: {
      host: doc.imap.host,
      port: doc.imap.port,
      user: doc.imap.user,
      pass: doc.imap.pass,
      archiveFolder: doc.imap.archiveFolder,
      inboxFolder: (doc.imap as { inboxFolder?: string }).inboxFolder ?? "INBOX",
      spamFolder: (doc.imap as { spamFolder?: string }).spamFolder ?? "Spam",
    },
    twenty: { apiUrl: doc.twenty.apiUrl },
    greeting: {
      model: doc.greeting.model,
      temperature: doc.greeting.temperature,
      maxTokens: doc.greeting.maxTokens,
      systemPrompt: doc.greeting.systemPrompt,
    },
    bccLogs: doc.bccLogs ?? null,
    paused: doc.paused,
    dryRun: doc.dryRun,
    updatedAt: (doc as MailSettingsDoc & { updatedAt: Date }).updatedAt,
  };
}

export async function getMailSettings(): Promise<MailSettings> {
  await connectDb();
  const existing = await MailSettingsModel.findById(MAIL_SETTINGS_ID).lean<MailSettingsDoc>();
  const settings = existing
    ? toDomain(existing)
    : toDomain((await MailSettingsModel.create({ _id: MAIL_SETTINGS_ID })).toObject() as MailSettingsDoc);
  return applyEnvFallbacks(settings);
}

// Mongo est autoritaire ; le .env sert de valeur de repli quand un champ
// SMTP/IMAP est resté vide en base. Ça permet de bootstrapper la config
// depuis le .env sans passer par /mailing/settings, tout en laissant
// n'importe quelle valeur saisie dans l'UI reprendre la main.
// N'est appliqué qu'à la lecture (getMailSettings), jamais à l'écriture,
// pour ne pas persister les valeurs env dans Mongo.
function applyEnvFallbacks(settings: MailSettings): MailSettings {
  const e = env();
  return {
    ...settings,
    smtp: {
      host: settings.smtp.host || e.SMTP_HOST || "",
      port: settings.smtp.port || e.SMTP_PORT || 587,
      // Booléen : "vide" = false (défaut du schéma Mongo). Si l'env dit true
      // et que Mongo est resté au défaut, env gagne — même logique que port.
      secure: settings.smtp.secure || e.SMTP_SECURE || false,
      user: settings.smtp.user || e.SMTP_USER || "",
      pass: settings.smtp.pass || e.SMTP_PASS || "",
      from: settings.smtp.from || e.SMTP_FROM || "",
    },
    imap: {
      host: settings.imap.host || e.IMAP_HOST || "",
      port: settings.imap.port || e.IMAP_PORT || 993,
      user: settings.imap.user || e.IMAP_USER || "",
      pass: settings.imap.pass || e.IMAP_PASS || "",
      archiveFolder: settings.imap.archiveFolder || e.IMAP_ARCHIVE_FOLDER,
      inboxFolder: settings.imap.inboxFolder,
      spamFolder: settings.imap.spamFolder,
    },
  };
}

export async function updateMailSettings(patch: Partial<MailSettingsInput>): Promise<MailSettings> {
  await connectDb();
  // Validation partielle : on ne re-valide que les champs présents.
  const parsed = mailSettingsInputSchema.partial().safeParse(patch);
  if (!parsed.success) {
    throw new Error(`MailSettings invalide : ${parsed.error.issues.map((i) => i.message).join(", ")}`);
  }
  const doc = await MailSettingsModel.findByIdAndUpdate(
    MAIL_SETTINGS_ID,
    { $set: parsed.data },
    { new: true, upsert: true },
  ).lean<MailSettingsDoc>();
  if (!doc) throw new Error("MailSettings introuvable après upsert");
  return toDomain(doc);
}
