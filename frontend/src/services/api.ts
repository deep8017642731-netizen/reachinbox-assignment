/**
 * The single HTTP client every service file uses.
 *
 * WHY ONE WRAPPER INSTEAD OF fetch() IN EACH COMPONENT
 *  - Every request needs the same three behaviours: send cookies, parse JSON,
 *    turn a failure into a typed error. Writing that per component guarantees
 *    drift and duplicated bugs.
 *  - Components call `api.get<T>(...)` and get a typed, already-unwrapped result,
 *    so they contain UI logic rather than protocol handling.
 *
 * HOW REQUESTS REACH THE BACKEND
 * `API_BASE` is empty by default, so requests are RELATIVE ("/api/emails/sent").
 * The Vite dev server proxies them to Express (see vite.config.ts). This is why
 * the browser sees a single origin: no CORS preflight, and the session cookie is
 * first-party so `SameSite=Lax` works.
 * In production behind one domain the same relative paths keep working unchanged.
 */
import type { ApiErrorBody } from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

/**
 * A failed request, carrying everything the UI needs to react:
 *  - `status`  so callers can special-case 401 (redirect to login) or 503 (degraded)
 *  - `details` so a form can attach messages to individual fields
 */
export class ApiError extends Error {
  readonly status: number;
  readonly details: { field: string; message: string }[];

  constructor(status: number, message: string, details: { field: string; message: string }[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  /** Field-level message for a form input, if the server sent one. */
  fieldError(field: string): string | undefined {
    return this.details.find((detail) => detail.field === field || detail.field.endsWith(`.${field}`))
      ?.message;
  }
}

export interface RequestOptions {
  /** Query string values; undefined/empty entries are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** AbortSignal from an effect cleanup, so navigating away cancels the request. */
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

async function parseBody(response: Response): Promise<unknown> {
  // 204 and empty bodies are legal; calling .json() on them would throw.
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A non-JSON body means a proxy or crash page, not our API.
    return { success: false, message: text.slice(0, 300) };
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  // Only set Content-Type when there IS a JSON body: sending it on a GET makes
  // the request non-simple and can trigger a needless preflight.
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      // Sends the session cookie. Without this, every request looks anonymous
      // and the user is bounced to the login page on every refresh.
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    // Network-level failure: the API is down, or the request was aborted.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Cannot reach the API. Is the backend running on port 3000?');
  }

  const payload = await parseBody(response);

  if (!response.ok) {
    const errorBody = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      errorBody?.message ?? `Request failed with status ${response.status}`,
      errorBody?.details ?? [],
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>('DELETE', path, undefined, options),
};

/**
 * Uploads a file as multipart/form-data.
 *
 * Separate from `api.post` because FormData must NOT have a Content-Type header
 * set manually — the browser adds it together with the multipart boundary, and
 * overriding it makes the request unparseable server-side. That single missing
 * boundary is a classic "why is my file upload empty?" bug.
 */
export async function uploadFile<T>(path: string, file: File, fieldName = 'file'): Promise<T> {
  const formData = new FormData();
  formData.append(fieldName, file);

  let response: Response;
  try {
    response = await fetch(buildUrl(path), {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the API. Is the backend running on port 3000?');
  }

  const payload = await parseBody(response);
  if (!response.ok) {
    const errorBody = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      errorBody?.message ?? `Upload failed with status ${response.status}`,
      errorBody?.details ?? [],
    );
  }
  return payload as T;
}
