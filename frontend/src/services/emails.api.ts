/**
 * Email API calls.
 *
 * Every function is a thin, typed description of one backend endpoint. Keeping
 * them here (rather than in components) means the HTTP surface of the app can be
 * read in one place, and a backend route change is a single edit.
 */
import { api, uploadFile } from './api';
import type {
  EmailListItem,
  EmailStats,
  PagedEmails,
  ParsedLeads,
  ScheduleEmailRequest,
  ScheduleEmailResponse,
} from '../types';

interface PagedResponse extends PagedEmails {
  success: true;
}

export function fetchScheduledEmails(
  page: number,
  limit: number,
  signal?: AbortSignal,
): Promise<PagedResponse> {
  return api.get<PagedResponse>('/api/emails/scheduled', { query: { page, limit }, signal });
}

export function fetchSentEmails(
  page: number,
  limit: number,
  signal?: AbortSignal,
): Promise<PagedResponse> {
  return api.get<PagedResponse>('/api/emails/sent', { query: { page, limit }, signal });
}

export function searchEmails(
  query: string,
  page: number,
  limit: number,
  signal?: AbortSignal,
): Promise<PagedResponse & { query: string }> {
  return api.get<PagedResponse & { query: string }>('/api/emails/search', {
    query: { q: query, page, limit },
    signal,
  });
}

export function scheduleEmails(payload: ScheduleEmailRequest): Promise<ScheduleEmailResponse> {
  return api.post<ScheduleEmailResponse>('/api/emails/schedule', payload);
}

export function cancelEmail(emailId: string): Promise<{ success: true; email: EmailListItem }> {
  return api.post<{ success: true; email: EmailListItem }>(`/api/emails/${emailId}/cancel`);
}

export function fetchEmailStats(signal?: AbortSignal): Promise<{ success: true; stats: EmailStats }> {
  return api.get<{ success: true; stats: EmailStats }>('/api/emails/stats', { signal });
}

/**
 * Server-side lead parsing.
 *
 * The UI also parses files locally for instant feedback (utils/parseLeads.ts).
 * This endpoint exists so the SAME rules are applied server-side before anything
 * is scheduled — the client is never trusted to decide what a valid address is.
 */
export function parseRecipientsFile(file: File): Promise<ParsedLeads & { success: true }> {
  return uploadFile<ParsedLeads & { success: true }>('/api/emails/parse-recipients', file);
}
