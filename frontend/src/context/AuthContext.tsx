/**
 * Authentication state for the whole app.
 *
 * WHAT IT DOES
 *   - Asks the API who is signed in (GET /api/auth/me) once at startup.
 *   - Exposes `user`, `loading` and `signOut()` to every component.
 *   - Reports which optional integrations exist, so the UI can disable buttons
 *     with an explanation instead of sending the user into a broken redirect.
 *
 * WHY /me RETURNING `user: null` MATTERS
 * The endpoint answers 200 with `user: null` for an anonymous visitor rather than
 * 401. "Not signed in yet" is a normal state on first load, not an error, and
 * treating it as one would flash an error message on every cold start.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { fetchMe, logout } from '../services/misc.api';
import type { AuthUser, IntegrationFlags } from '../types';

interface AuthContextValue {
  user: AuthUser | null;
  /** True while the initial /me request is in flight. */
  loading: boolean;
  integrations: IntegrationFlags;
  /** True when the backend runs with the development auth bypass enabled. */
  devAuthBypass: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const UNKNOWN_INTEGRATIONS: IntegrationFlags = {
  googleOAuth: false,
  slackOAuth: false,
  smtp: false,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationFlags>(UNKNOWN_INTEGRATIONS);
  const [devAuthBypass, setDevAuthBypass] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetchMe(signal);
      setUser(response.user);
      setIntegrations(response.integrations);
      setDevAuthBypass(response.devAuthBypass);
    } catch (error) {
      // A failure here means the API is unreachable. Treat it as signed-out
      // rather than throwing: the login page is the correct destination, and it
      // explains the situation.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await load();
  }, [load]);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      // Clear local state even if the request failed: the user asked to leave,
      // and the session cookie is cleared by the server response anyway.
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, integrations, devAuthBypass, refresh, signOut }),
    [user, loading, integrations, devAuthBypass, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth() must be used inside <AuthProvider>');
  return context;
}
