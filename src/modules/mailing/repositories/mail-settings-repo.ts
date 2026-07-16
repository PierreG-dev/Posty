import { connectDb } from "@/modules/shared/db/mongoose";
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
  if (existing) return toDomain(existing);
  const created = await MailSettingsModel.create({ _id: MAIL_SETTINGS_ID });
  return toDomain(created.toObject() as MailSettingsDoc);
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
