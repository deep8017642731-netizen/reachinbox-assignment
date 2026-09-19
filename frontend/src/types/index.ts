/**
 * Frontend type contracts.
 *
 * These MIRROR the backend response shapes (see backend/src/services/*.service.ts).
 * They are duplicated rather than imported across the monorepo on purpose: the two
 * applications deploy separately, and a shared package would need its own build
 * step for one small file. If the backend contract changes, TypeScript points at
 * every place in the UI that needs updating.
 *
 * Note what is NOT here: no Slack access token, no session secret, nothing that
 * the API does not actually return.
 */

/* -------------------------------------------------------------------------- */
/*  Generic API envelope                                                      */
/* -------------------------------------------------------------------------- */

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  success: false;
  message: string;
  details?: ApiErrorDetail[];
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/* -------------------------------------------------------------------------- */
/*  Auth                                                                      */
/* -------------------------------------------------------------------------- */

export interface AuthUser {
  id: string;
  googleId: string;
  name: string;
  email: string;
  avatar: string | null;
}

export interface IntegrationFlags {
  googleOAuth: boolean;
  slackOAuth: boolean;
  smtp: boolean;
}

export interface MeResponse {
  success: true;
  user: AuthUser | null;
  integrations: IntegrationFlags;
  /** True when the backend is running with the development auth bypass. */
  devAuthBypass: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Emails                                                                    */
/* -------------------------------------------------------------------------- */

/** Exactly the backend's `EmailStatus` union. */
export type EmailStatus = 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';

export interface EmailSenderSummary {
  id: string;
  email: string;
  displayName: string | null;
}

export interface EmailListItem {
  id: string;
  batchId: string;
  recipient: string;
  subject: string;
  bodyPreview: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  attempts: number;
  sequence: number;
  sender: EmailSenderSummary;
  createdAt: string;
  /** Ethereal preview link, present after a successful send. */
  previewUrl: string | null;
}

export interface PagedEmails {
  items: EmailListItem[];
  meta: PaginationMeta;
}

export interface ScheduleEmailRequest {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
}

export interface ScheduleEmailResponse {
  success: true;
  message: string;
  batchId: string;
  scheduledCount: number;
  emailIds: string[];
  duplicatesRemoved: number;
  appliedDelayMs: number;
  startTimeAdjusted: boolean;
  firstScheduledAt: string;
  lastScheduledAt: string;
  enforced: { delayBetweenEmailsMs: number; hourlyLimit: number };
}

export interface EmailStats {
  scheduled: number;
  processing: number;
  sent: number;
  failed: number;
  cancelled: number;
  total: number;
}

/* -------------------------------------------------------------------------- */
/*  Senders                                                                   */
/* -------------------------------------------------------------------------- */

export interface SenderUsage {
  usedThisHour: number;
  limit: number;
  resetsAt: string;
}

export interface Sender {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  /** null when Redis is unreachable — the UI simply omits the usage bar. */
  usage: SenderUsage | null;
}

/* -------------------------------------------------------------------------- */
/*  Slack                                                                     */
/* -------------------------------------------------------------------------- */

export interface SlackStatus {
  connected: boolean;
  teamId: string | null;
  teamName: string | null;
  channelId: string | null;
  channelName: string | null;
  /** Whether this deployment has Slack credentials at all. */
  configured: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Lead parsing (mirrors backend/src/utils/email-parser.ts)                  */
/* -------------------------------------------------------------------------- */

export interface ParsedLeads {
  valid: string[];
  invalid: string[];
  duplicatesRemoved: number;
  totalCandidates: number;
  truncated: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Health                                                                    */
/* -------------------------------------------------------------------------- */

export type ServiceState = 'ok' | 'down' | 'not-configured';

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptimeSeconds: number;
  services: {
    database: ServiceState;
    redis: ServiceState;
    elasticsearch: ServiceState;
  };
  queue: Record<string, number>;
  scheduler: {
    workerConcurrency: number;
    minEmailDelayMs: number;
    defaultHourlyLimit: number;
    smtpConfigured: boolean;
  };
}
