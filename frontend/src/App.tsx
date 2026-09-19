/**
 * App shell: providers, routing and the auth gate.
 *
 * ROUTE SHAPE (chosen to match the frames)
 *   /login                     centred login card (AP1)
 *   /dashboard/scheduled       sidebar layout + list (AP2)
 *   /dashboard/sent            sidebar layout + list (P3)
 *   /dashboard/compose         full-width composer, no sidebar (AP5-AP7)
 *   /dashboard/emails/:id      full-width message view, no sidebar (AP4)
 *
 * Why the sidebar layout is a ROUTE instead of a component each page renders:
 *   - `/dashboard/scheduled` and `/dashboard/sent` are real URLs, so the nav items
 *     are links (shareable, back-button friendly) rather than click handlers.
 *   - Compose and the message view intentionally sit OUTSIDE it, because both
 *     frames show a full-width page with no navigation rail.
 *
 * The backend performs real browser redirects to absolute paths
 * (`${FRONTEND_URL}/dashboard` after Google sign-in, `?slack=connected` after
 * Slack), which is why this is real routing rather than a screen boolean: those
 * paths must exist and the query string must survive.
 */
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider, ToastViewport } from './context/ToastContext';
import { DashboardLayout } from './layouts/DashboardLayout';
import { LoginPage } from './pages/LoginPage';
import { EmailsPage } from './pages/EmailsPage';
import { ComposePage } from './pages/ComposePage';
import { EmailDetailPage } from './pages/EmailDetailPage';

/** Blocks protected routes until we know whether there is a session. */
function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <svg className="h-6 w-6 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
        </svg>
        <p className="text-sm text-slate-500">Loading your dashboard…</p>
      </div>
    );
  }

  if (!user) {
    // `replace` keeps the protected URL out of history so Back does not bounce
    // the user between the dashboard and the login page.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

/** Sends an already-authenticated visitor away from /login. */
function RedirectIfAuthenticated({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthenticated>
            <LoginPage />
          </RedirectIfAuthenticated>
        }
      />

      {/* Sidebar layout: the two list views. */}
      <Route
        element={
          <RequireAuth>
            <DashboardLayout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Navigate to="/dashboard/scheduled" replace />} />
        <Route path="/dashboard/scheduled" element={<EmailsPage variant="scheduled" />} />
        <Route path="/dashboard/sent" element={<EmailsPage variant="sent" />} />
      </Route>

      {/* Full-width pages: no sidebar, matching the design frames. */}
      <Route
        path="/dashboard/compose"
        element={
          <RequireAuth>
            <ComposePage />
          </RequireAuth>
        }
      />
      <Route
        path="/dashboard/emails/:id"
        element={
          <RequireAuth>
            <EmailDetailPage />
          </RequireAuth>
        }
      />

      {/* Unknown paths go to the dashboard, which redirects to /login when there
          is no session. */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      {/* ToastProvider is outermost so even an auth failure can raise a toast. */}
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
          {/* Rendered once; components reach it through useToast(). */}
          <ToastViewport />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
