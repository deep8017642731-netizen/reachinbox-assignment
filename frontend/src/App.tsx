/**
 * App shell: providers, routing and the auth gate.
 *
 * ROUTES
 *   /login      public
 *   /dashboard  requires a session
 *   anything else redirects
 *
 * WHY react-router AND NOT CONDITIONAL RENDERING
 * The backend performs real browser redirects to absolute paths
 * (`${FRONTEND_URL}/dashboard` after Google login, `?slack=connected` after Slack).
 * Those paths must exist as routes. A state-only "which screen am I showing"
 * boolean would render the wrong page on arrival and lose the query string the
 * dashboard needs to report the Slack result.
 *
 * THE AUTH GATE deliberately renders a full-page loading state while the first
 * /api/auth/me request is in flight. Rendering the dashboard first and redirecting
 * afterwards would flash the UI for a split second and then bounce the user out —
 * the classic signed-out flicker.
 */
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider, ToastViewport } from './context/ToastContext';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { Spinner } from './components/ui/Feedback';

/** Blocks /dashboard until we know whether there is a session. */
function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3">
        <Spinner size={26} />
        <p className="text-sm text-slate-500">Loading your dashboard…</p>
      </div>
    );
  }

  if (!user) {
    // `replace` keeps the protected URL out of history, so Back does not bounce
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
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      {/* Unknown paths (including "/") go to the dashboard, which redirects to
          /login if there is no session. */}
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
          {/* Rendered once; every component talks to it through useToast(). */}
          <ToastViewport />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
