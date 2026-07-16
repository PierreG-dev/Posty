import { z } from "zod";

// CDC-02 §4.1 — singleton mail_settings. Éditable depuis /mailing/settings et
// /mailing/sequence. Les credentials SMTP/IMAP/Twenty sont stockés en clair
// dans Mongo (base locale, monoservice) mais l'UI masque les mots de passe.

export const sendDaySchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7), // 1=lundi, 7=dimanche (ISO)
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 24h attendu"),
});
export type SendDay = z.infer<typeof sendDaySchema>;

export const jitterSchema = z
  .object({
    minSeconds: z.number().int().min(0).max(3600),
    maxSeconds: z.number().int().min(0).max(3600),
  })
  .refine((v) => v.maxSeconds >= v.minSeconds, { message: "maxSeconds >= minSeconds" });

export const sequenceCfgSchema = z.object({
  // CDC-02 §4.1 : délais en jours après le mail step 0 → step 1 → step 2 → fin.
  delays: z.array(z.number().int().min(0).max(365)).length(3),
  clientRelanceDays: z.number().int().min(0).default(60), // conservé, inutilisé v1 (§5.3)
});

export const smtpCfgSchema = z.object({
  host: z.string().default(""),
  port: z.number().int().positive().default(587),
  secure: z.boolean().default(false),
  user: z.string().default(""),
  pass: z.string().default(""),
  from: z.string().default(""),
});

export const imapCfgSchema = z.object({
  host: z.string().default(""),
  port: z.number().int().positive().default(993),
  user: z.string().default(""),
  pass: z.string().default(""),
  archiveFolder: z.string().default("Posty"),
  // §15 point ouvert 4 — certains rapports de non-remise atterrissent en
  // indésirables. On scanne les deux dossiers (INBOX + spam). Nom configurable.
  inboxFolder: z.string().default("INBOX"),
  spamFolder: z.string().default("Spam"),
});

export const twentyCfgSchema = z.object({
  apiUrl: z.string().default(""),
  // Le token n'est PAS stocké ici — il vit dans TWENTY_API_KEY (.env),
  // exclusivement envoyé en header Authorization: Bearer. On ne le duplique
  // pas en base (§0 CDC-02).
});

// Config de la génération de salutation (§6.1).
// Sonnet par défaut sur décision utilisateur (le CDC citait Haiku ; l'user
// préfère Sonnet — voir docs/lots/07.md).
export const greetingCfgSchema = z.object({
  model: z.string().default("claude-sonnet-4-6"),
  temperature: z.number().min(0).max(1).default(0),
  maxTokens: z.number().int().min(10).max(500).default(100),
  // Le prompt système est éditable depuis l'UI. Défaut = règles §6.1 CDC-02.
  systemPrompt: z.string().default(DEFAULT_GREETING_PROMPT()),
});
export type GreetingCfg = z.infer<typeof greetingCfgSchema>;

export const mailSettingsInputSchema = z.object({
  sendDays: z.array(sendDaySchema).min(1).default([
    { dayOfWeek: 2, time: "10:30" },
    { dayOfWeek: 4, time: "14:00" },
  ]),
  dailyCap: z.number().int().min(1).max(500).default(25),
  jitter: jitterSchema.default({ minSeconds: 45, maxSeconds: 180 }),
  sequence: sequenceCfgSchema.default({ delays: [5, 9, 60], clientRelanceDays: 60 }),
  smtp: smtpCfgSchema.default({}),
  imap: imapCfgSchema.default({}),
  twenty: twentyCfgSchema.default({}),
  greeting: greetingCfgSchema.default({}),
  bccLogs: z.string().email().nullable().default(null),
  paused: z.boolean().default(false),
  dryRun: z.boolean().default(true),
});
export type MailSettingsInput = z.infer<typeof mailSettingsInputSchema>;

export const mailSettingsSchema = mailSettingsInputSchema.extend({
  _id: z.literal("singleton"),
  updatedAt: z.date(),
});
export type MailSettings = z.infer<typeof mailSettingsSchema>;

/**
 * Prompt de salutation par défaut, dérivé des règles §6.1 CDC-02.
 * Éditable via l'UI — ce n'est PAS une transcription d'un prompt Groq
 * existant (que je n'ai pas), c'est un défaut travaillant. L'utilisateur
 * l'ajustera à l'usage.
 */
export function DEFAULT_GREETING_PROMPT(): string {
  return `Tu génères UNIQUEMENT la salutation d'un email de prospection en français.

Entrée : le nom exact d'un organisme (école, entreprise, association).
Sortie : une seule ligne, terminée par une virgule, sans autre texte.

Règles :
- Commence toujours par "Bonjour".
- Choisis l'article correct devant le nom : "du" / "de la" / "de l'" / "des" selon le genre et le nombre. Si l'organisme est étranger ou son genre ambigu, préfère "de".
- Formule "Bonjour l'équipe {article} {nom}," pour les structures collectives (écoles, associations, entreprises).
- Respecte la casse et l'orthographe du nom fourni (accents, apostrophes, capitalisation).
- Exceptions connues à corriger silencieusement :
  * "lereacteur" → "du Reacteur"
- N'ajoute JAMAIS de commentaire, d'explication, de guillemets, de saut de ligne, ni de préambule.

Exemples :
- Entrée : "O'Clock" → Sortie : "Bonjour l'équipe d'O'Clock,"
- Entrée : "École 42" → Sortie : "Bonjour l'équipe de l'École 42,"
- Entrée : "OpenClassrooms" → Sortie : "Bonjour l'équipe d'OpenClassrooms,"
- Entrée : "lereacteur" → Sortie : "Bonjour l'équipe du Reacteur,"`;
}
