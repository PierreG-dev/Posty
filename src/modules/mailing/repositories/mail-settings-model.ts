import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { DEFAULT_GREETING_PROMPT } from "@/modules/mailing/domain/mail-settings";

const SINGLETON_ID = "singleton" as const;

const sendDaySchema = new Schema({ dayOfWeek: Number, time: String }, { _id: false });
const jitterSchema = new Schema({ minSeconds: Number, maxSeconds: Number }, { _id: false });
const sequenceSchema = new Schema(
  { delays: [Number], clientRelanceDays: { type: Number, default: 60 } },
  { _id: false },
);
const smtpSchema = new Schema(
  {
    host: { type: String, default: "" },
    port: { type: Number, default: 587 },
    secure: { type: Boolean, default: false },
    user: { type: String, default: "" },
    pass: { type: String, default: "" },
    from: { type: String, default: "" },
  },
  { _id: false },
);
const imapSchema = new Schema(
  {
    host: { type: String, default: "" },
    port: { type: Number, default: 993 },
    user: { type: String, default: "" },
    pass: { type: String, default: "" },
    archiveFolder: { type: String, default: "Posty" },
    inboxFolder: { type: String, default: "INBOX" },
    spamFolder: { type: String, default: "Spam" },
  },
  { _id: false },
);
const twentyCfgSchema = new Schema(
  { apiUrl: { type: String, default: "" } },
  { _id: false },
);
const greetingSchema = new Schema(
  {
    model: { type: String, default: "claude-sonnet-4-6" },
    temperature: { type: Number, default: 0 },
    maxTokens: { type: Number, default: 100 },
    systemPrompt: { type: String, default: () => DEFAULT_GREETING_PROMPT() },
  },
  { _id: false },
);

const mailSettingsSchema = new Schema(
  {
    _id: { type: String, default: SINGLETON_ID },
    sendDays: {
      type: [sendDaySchema],
      default: () => [
        { dayOfWeek: 2, time: "10:30" },
        { dayOfWeek: 4, time: "14:00" },
      ],
    },
    dailyCap: { type: Number, default: 25 },
    jitter: { type: jitterSchema, default: () => ({ minSeconds: 45, maxSeconds: 180 }) },
    sequence: { type: sequenceSchema, default: () => ({ delays: [5, 9, 60], clientRelanceDays: 60 }) },
    smtp: { type: smtpSchema, default: () => ({}) },
    imap: { type: imapSchema, default: () => ({}) },
    twenty: { type: twentyCfgSchema, default: () => ({}) },
    greeting: { type: greetingSchema, default: () => ({}) },
    bccLogs: { type: String, default: null },
    paused: { type: Boolean, default: false },
    dryRun: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: false, updatedAt: true }, collection: "mail_settings" },
);

export type MailSettingsDoc = InferSchemaType<typeof mailSettingsSchema> & { _id: string };

type MailSettingsModelT = Model<MailSettingsDoc>;
export const MailSettingsModel: MailSettingsModelT =
  (models.MailSettings as MailSettingsModelT | undefined) ??
  model<MailSettingsDoc>("MailSettings", mailSettingsSchema);
export const MAIL_SETTINGS_ID = SINGLETON_ID;
