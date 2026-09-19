/**
 * Vite configuration.
 *
 * TWO SETTINGS HERE EXIST SPECIFICALLY FOR THIS PROJECT'S ENVIRONMENT:
 *
 * 1. `server.host = '0.0.0.0'`
 *    Binding to 127.0.0.1 would make the dev server reachable only from inside
 *    the machine it runs on. Binding to all interfaces is what allows a container,
 *    a VM, or a hosted preview to serve it.
 *
 * 2. `server.allowedHosts = true`
 *    Vite rejects requests whose Host header it does not recognise (a protection
 *    against DNS-rebinding attacks). A hosted preview is reached through a domain
 *    Vite has never heard of, so without this the page fails with
 *    "Blocked request. This host is not allowed."
 *    Safe here because this is a development server; in production the built
 *    static files are served by a real web server instead.
 *
 * 3. The PROXY is the reason the React code never hardcodes a backend URL.
 *    The app fetches `/api/emails/scheduled` (a relative path); Vite forwards it
 *    to the Express server. That means:
 *      - the browser sees ONE origin, so there is no CORS preflight in dev, and
 *      - the session cookie is a first-party cookie, so `SameSite=Lax` works and
 *        login survives a page refresh.
 *    If the browser called http://localhost:3000 directly it would be a
 *    cross-origin request, and the cookie would be blocked by the browser.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Where the Express API runs in development. */
const BACKEND = process.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    react(),
    // Tailwind 4 is a Vite plugin; there is no tailwind.config.js and no
    // PostCSS setup. Theme customisation lives in src/index.css via @theme.
    tailwindcss(),
  ],
  server: {
    host: '0.0.0.0',
    // 5173 is the Vite default; if it is taken, Vite tries the next free port
    // rather than failing, which matters when several projects run at once.
    port: 5173,
    strictPort: false,
    // See note 2 above.
    allowedHosts: true,
    proxy: {
      // REST API
      '/api': { target: BACKEND, changeOrigin: true },
      // Browser-facing OAuth redirect routes (/auth/google, /auth/slack/callback)
      '/auth': { target: BACKEND, changeOrigin: true },
      /**
       * Bull Board (/admin/queues).
       *
       * Proxy this too, otherwise the dashboard's "Bull Board" button would hit
       * Vite, which would serve index.html for the unknown path and silently
       * render the React app again instead of the queue dashboard. Bull Board's
       * static assets are served relative to its base path, so proxying the whole
       * /admin prefix keeps its CSS and JS working as well.
       *
       * In production the same rule applies: your reverse proxy must forward
       * /admin to the backend (see README → Bull Board).
       */
      '/admin': { target: BACKEND, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
