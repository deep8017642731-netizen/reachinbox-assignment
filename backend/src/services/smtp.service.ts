/**
 * SMTP delivery through Ethereal (Nodemailer).
 *
 * WHAT IS ETHEREAL?
 * A fake SMTP server for developers. It accepts real SMTP conversations (real
 * TCP, real authentication, real message envelope) and keeps the messages in a
 * web inbox instead of delivering them to a human. So the *client-side* code path
 * is production-grade — swapping Ethereal for Gmail/SES/SendGrid is a change of
 * host/port/credentials and nothing else — while no real person is ever emailed.
 * That is precisely why the assignment specifies it.
 *
 * CREDENTIAL HANDLING
 * Credentials always come from the environment; nothing is hardcoded. To make
 * first-run easy, if SMTP_USER/SMTP_PASS are empty in development we ask Ethereal
 * for a real throwaway account (this is a real API call to ethereal.email, not a
 * stub) and log the credentials so they can be pasted into .env. In production an
 * unconfigured SMTP is a hard error: silently creating a test account there would
 * mean "emails the user thinks were delivered" going to a dev sandbox.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { env, isProduction, isSmtpConfigured } from '../config/env';
import { AppError } from '../middleware/error.middleware';
import { createLogger } from '../lib/logger';

const log = createLogger('SMTP');

export type SmtpMode = 'env' | 'ethereal-auto';

interface TransportHandle {
  transport: Transporter;
  mode: SmtpMode;
  from: string;
}

/**
 * Memoised as a PROMISE, not a resolved value: two concurrent emails arriving
 * before the transport exists would otherwise each create a transport (and, in
 * auto mode, each create a separate Ethereal account).
 */
let transportPromise: Promise<TransportHandle> | null = null;

function buildTransportFromEnv(): TransportHandle {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER as string, pass: env.SMTP_PASS as string },
  });
  return { transport, mode: 'env', from: env.SMTP_FROM };
}

async function buildTransportAuto(): Promise<TransportHandle> {
  const account = await nodemailer.createTestAccount();

  log.warn(
    'SMTP_USER/SMTP_PASS are empty — created a temporary Ethereal test account. ' +
      'Add these to backend/.env to keep the same inbox across restarts.',
    { SMTP_USER: account.user, SMTP_PASS: account.pass, host: account.smtp.host, port: account.smtp.port },
  );

  const transport = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
  });

  return { transport, mode: 'ethereal-auto', from: env.SMTP_FROM };
}

export async function getTransport(): Promise<TransportHandle> {
  if (!transportPromise) {
    if (isSmtpConfigured()) {
      transportPromise = Promise.resolve(buildTransportFromEnv());
    } else if (isProduction) {
      // Fail fast: never invent credentials in production.
      throw AppError.notConfigured(
        'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM.',
      );
    } else {
      transportPromise = buildTransportAuto().catch((error: unknown) => {
        transportPromise = null; // allow a later retry instead of caching failure
        throw new Error(
          `Could not create an Ethereal test account (${error instanceof Error ? error.message : 'unknown error'}). ` +
            'Check your network, or set SMTP_USER/SMTP_PASS in backend/.env.',
        );
      });
    }
  }
  return transportPromise;
}

/** Drops the cached transport (tests, or after credentials change). */
export function resetTransportCache(): void {
  transportPromise = null;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  /** Plain text. Kept as text deliberately: no HTML injection from user content. */
  body: string;
  /** Optional override of SMTP_FROM (e.g. the sender's display name). */
  from?: string;
}

export interface SendEmailResult {
  messageId: string;
  /** Ethereal web-inbox link. Null for real SMTP servers. */
  previewUrl: string | null;
  accepted: string[];
  rejected: string[];
  response: string;
}

/**
 * Hands one message to SMTP. Throws on failure — the WORKER decides what a
 * failure means (retry vs mark FAILED); this function only reports the truth.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { transport, from } = await getTransport();

  const info = (await transport.sendMail({
    from: input.from ?? from,
    to: input.to,
    subject: input.subject,
    text: input.body,
  })) as SMTPTransport.SentMessageInfo;

  // Only Ethereal messages have a hosted preview; real servers return false.
  const previewUrl = nodemailer.getTestMessageUrl(info);

  return {
    messageId: info.messageId,
    previewUrl: typeof previewUrl === 'string' ? previewUrl : null,
    accepted: normaliseAddresses(info.accepted),
    rejected: normaliseAddresses(info.rejected),
    response: typeof info.response === 'string' ? info.response : '',
  };
}

/** Nodemailer can return addresses as strings or as {address} objects. */
function normaliseAddresses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && 'address' in entry) {
      return String((entry as { address: unknown }).address);
    }
    return String(entry);
  });
}

export interface SmtpHealth {
  ok: boolean;
  mode: SmtpMode | 'unconfigured';
  host: string;
  error?: string;
}

/** Opens a real connection and authenticates — used by GET /api/health. */
export async function checkSmtp(): Promise<SmtpHealth> {
  if (!isSmtpConfigured() && isProduction) {
    return { ok: false, mode: 'unconfigured', host: env.SMTP_HOST, error: 'SMTP not configured' };
  }
  try {
    const { transport, mode } = await getTransport();
    await transport.verify();
    return { ok: true, mode, host: env.SMTP_HOST };
  } catch (error) {
    return {
      ok: false,
      mode: isSmtpConfigured() ? 'env' : 'unconfigured',
      host: env.SMTP_HOST,
      error: error instanceof Error ? error.message.split('\n')[0] : 'unknown error',
    };
  }
}
