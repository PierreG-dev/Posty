import { z } from "zod";

const schema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TZ: z.string().default("Europe/Paris"),

  AUTH_PASSWORD_HASH: z.string().min(1, "AUTH_PASSWORD_HASH manquant (base64 d'un hash argon2id)"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET doit faire >= 32 caractères"),
  ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY manquant (32 octets base64)"),

  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1).default("posty"),

  ASSETS_DIR: z.string().default("./data/assets"),

  // LinkedIn (§10 CDC-01). Optionnels : l'app démarre sans, mais toute route
  // qui les touche vérifie leur présence à l'exécution et renvoie 503 sinon.
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_REDIRECT_URI: z.string().url().optional(),
  LINKEDIN_API_VERSION: z.string().regex(/^\d{6}$/, "Format YYYYMM attendu").default("202506"),

  // Anthropic (§8 CDC-01). Clé optionnelle : l'app démarre sans (typecheck/CI),
  // mais toute route qui appelle Claude vérifie sa présence à l'exécution.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),

  // Twenty CRM (CDC-02 §0, §14). Clé transmise UNIQUEMENT en header
  // Authorization: Bearer. Jamais en query string. Optionnelles au démarrage,
  // les routes /api/mailing/* renvoient 503 si absentes.
  TWENTY_API_URL: z.string().url().optional(),
  TWENTY_API_KEY: z.string().min(1).optional(),

  // SMTP / IMAP (CDC-02 §14) — utilisés à partir du lot 8 / lot 9. Optionnels
  // pour ne pas bloquer le démarrage tant que la config n'existe pas.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().optional(),

  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.coerce.number().int().positive().optional(),
  IMAP_USER: z.string().optional(),
  IMAP_PASS: z.string().optional(),
  IMAP_ARCHIVE_FOLDER: z.string().default("Posty"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Environnement invalide :\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
