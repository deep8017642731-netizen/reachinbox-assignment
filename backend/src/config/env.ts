/**
 * Environment configuration — validated once, at startup, so nothing else in the
 * codebase has to wonder whether a variable exists or is the right type.
 *
 * WHY VALIDATE ENVIRONMENT VARIABLES?
 * Process env vars are always `string | undefined`. Without validation you get
 * bugs like `PORT` being the string "3000", `WORKER_CONCURRENCY` being the string
 * "5" (so `concurrency: "5"` behaves nothing like `concurrency: 5`), or a typo
 * in `DATABASE_URL` surfacing as a confusing runtime crash 20 minutes later.
 *
 * Here, a bad or missing variable stops the process immediately with a message
 * that tells you exactly what to fix. This is called "fail fast": a loud failure
 * at boot is far cheaper than a silent misbehaviour during a demo.
 */
import dotenv from 'dotenv';
import { z } from 'zod';

// Loads backend/.env into process.env. Must run before we read anything.
dotenv.config();

/** Treats an empty string the same as "not set" — `SMTP_USER=` means unset. */
const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
  });

/** Accepts "true"/"false" (env vars are strings) and yields a real boolean. */
const booleanish = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');

const envSchema = z.object({
  // ----- runtime -----------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  FRONTEND_URL: z.url().default('http://localhost:5173'),
  BACKEND_URL: z.url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // ----- PostgreSQL --------------------------------------------------------
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required — copy .env.example to .env and fill it in'),

  // ----- Redis -------------------------------------------------------------
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  REDIS_PASSWORD: optionalString,

  // ----- Elasticsearch -----------------------------------------------------
  ELASTICSEARCH_URL: z.url().default('http://localhost:9200'),
  ELASTICSEARCH_USERNAME: optionalString,
  ELASTICSEARCH_PASSWORD: optionalString,
  ELASTICSEARCH_EMAIL_INDEX: z.string().min(1).default('emails'),

  // ----- scheduler tuning --------------------------------------------------
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(5),
  MIN_EMAIL_DELAY_MS: z.coerce.number().int().min(0).max(600_000).default(2000),
  EMAILS_PER_HOUR: z.coerce.number().int().min(1).max(1_000_000).default(50),

  // ----- SMTP (Ethereal) ---------------------------------------------------
  SMTP_HOST: z.string().min(1).default('smtp.ethereal.email'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: booleanish(false),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_FROM: z.string().min(1).default('ReachInbox Scheduler <no-reply@reachinbox.test>'),

  // ----- Google OAuth ------------------------------------------------------
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_CALLBACK_URL: z.url().default('http://localhost:3000/auth/google/callback'),

  // ----- sessions ----------------------------------------------------------
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 365).default(168),

  // ----- Slack OAuth -------------------------------------------------------
  SLACK_CLIENT_ID: optionalString,
  SLACK_CLIENT_SECRET: optionalString,
  SLACK_REDIRECT_URI: z.url().default('http://localhost:3000/auth/slack/callback'),
  SLACK_SCOPES: z.string().default('chat:write,channels:read,team:read'),
  SLACK_ALERT_CHANNEL: optionalString,

  // ----- admin -------------------------------------------------------------
  ADMIN_EMAILS: optionalString,

  // ----- development conveniences -----------------------------------------
  /**
   * Lets the API be used before Google OAuth credentials exist (they are
   * optional, so you can demo the scheduler without a Google Cloud project).
   * Refused in production — see config/env.ts `assertDevAuthBypassAllowed`.
   */
  DEV_AUTH_BYPASS: booleanish(false),
});

export type Env = z.infer<typeof envSchema>;

/** The literal value shipped in .env.example — never valid as a real secret. */
const PLACEHOLDER_SESSION_SECRET = 'replace-me-with-a-long-random-string';

function fail(message: string, hints: string[]): never {
  // Written with console (not the logger) because the logger itself reads env.
  console.error(`\n❌ Invalid environment configuration\n\n${message}\n`);
  if (hints.length > 0) {
    console.error('How to fix:');
    for (const hint of hints) console.error(`  • ${hint}`);
    console.error('');
  }
  process.exit(1);
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    fail(lines.join('\n'), [
      'Copy the template:  cp backend/.env.example backend/.env',
      'Every variable is documented inside that file.',
    ]);
  }

  const env = parsed.data;

  // A copied-but-unchanged secret is worse than a missing one, because it looks
  // configured. Refuse it in production, warn loudly in development.
  if (env.SESSION_SECRET === PLACEHOLDER_SESSION_SECRET) {
    const hint =
      process.platform === 'win32'
        ? 'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
        : `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`;
    if (env.NODE_ENV === 'production') {
      fail('  • SESSION_SECRET is still the placeholder from .env.example', [
        `Generate a real one: ${hint}`,
      ]);
    }
    console.warn(
      '\n⚠️  SESSION_SECRET is still the placeholder value. This is fine for local' +
        `\n    development but must be replaced before deploying.\n    Generate one with: ${hint}\n`,
    );
  }

  return env;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

/** ADMIN_EMAILS is a comma-separated list; the API compares against it. */
export const adminEmails: string[] = (env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

/* -------------------------------------------------------------------------- */
/*  Optional integrations                                                     */
/* -------------------------------------------------------------------------- */
/*
 * Google/Slack credentials and Ethereal SMTP details are OPTIONAL so the project
 * boots (and the scheduler + worker run) without them. Each integration has a
 * function below that turns "is it configured?" into an explicit, typed answer,
 * so no code path ever silently pretends a credential exists.
 */

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackUrl: env.GOOGLE_CALLBACK_URL,
  };
}

export interface SlackOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export function getSlackOAuthConfig(): SlackOAuthConfig | null {
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) return null;
  return {
    clientId: env.SLACK_CLIENT_ID,
    clientSecret: env.SLACK_CLIENT_SECRET,
    redirectUri: env.SLACK_REDIRECT_URI,
    scopes: env.SLACK_SCOPES.split(',').map((scope) => scope.trim()).filter(Boolean),
  };
}

export function isSmtpConfigured(): boolean {
  return Boolean(env.SMTP_USER && env.SMTP_PASS);
}

/** Human-readable integration status, printed once at boot. */
export function describeIntegrations(): Array<{ name: string; status: string; ok: boolean }> {
  const google = getGoogleOAuthConfig();
  const slack = getSlackOAuthConfig();
  return [
    {
      name: 'PostgreSQL',
      status: env.DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@'),
      ok: true,
    },
    { name: 'Redis', status: `${env.REDIS_HOST}:${env.REDIS_PORT}`, ok: true },
    { name: 'Elasticsearch', status: env.ELASTICSEARCH_URL, ok: true },
    {
      name: 'SMTP (Ethereal)',
      status: isSmtpConfigured()
        ? `${env.SMTP_HOST} as ${env.SMTP_USER}`
        : 'not configured yet — run `npm run ethereal:setup`',
      ok: isSmtpConfigured(),
    },
    {
      name: 'Google OAuth',
      status: google ? `client ${google.clientId.slice(0, 12)}…` : 'not configured (see README)',
      ok: Boolean(google),
    },
    {
      name: 'Slack OAuth',
      status: slack ? `client ${slack.clientId.slice(0, 12)}…` : 'not configured (see README)',
      ok: Boolean(slack),
    },
  ];
}

/**
 * Guard for the development auth bypass. Call this once at boot.
 * The bypass exists so the scheduler can be demonstrated before Google OAuth
 * credentials are set up; it must never be possible in production.
 */
export function assertDevAuthBypassAllowed(): void {
  if (env.DEV_AUTH_BYPASS && isProduction) {
    fail('  • DEV_AUTH_BYPASS=true is not allowed when NODE_ENV=production', [
      'Set DEV_AUTH_BYPASS=false, or configure real Google OAuth.',
    ]);
  }
}
