import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The Docker build copies only frontend/ into its build stage (no .git),
// so it passes the commit it's building from via this env var (see
// Dockerfile's COMMIT_SHA build arg). Falls back to reading git directly,
// which works for local `npm run dev`/`build` where .git is present.
function resolveCommitSha(): string {
  if (process.env.COMMIT_SHA) return process.env.COMMIT_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_COMMIT__: JSON.stringify(resolveCommitSha()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // The plugin's own auto-injected register script reloads the page
      // the instant a new service worker takes control — no warning, no
      // regard for whatever the user's mid-interaction with (reported:
      // the PWA "crashing" right after using search, on a session that
      // happened to line up with a fresh deploy landing). registerType
      // 'autoUpdate' still means the new worker activates itself promptly
      // in the background (that part's fine, nothing user-visible) — it's
      // specifically the forced reload that's disruptive. Registering it
      // ourselves via useRegisterSW (see UpdateAvailableBanner.tsx) instead
      // surfaces a dismissible "actualizar" banner and reloads only when
      // the user taps it. injectRegister: null stops the plugin from also
      // injecting its own auto-reloading version alongside ours.
      injectRegister: null,
      // Runs the service worker in dev too (not just `vite build`), since
      // that's how this app actually gets tested and used day to day.
      devOptions: { enabled: true, type: 'module' },
      includeAssets: ['images/favicon-64.png', 'images/familyseed-icon.png'],
      manifest: {
        name: 'FamilySeed',
        short_name: 'FamilySeed',
        description: 'Árbol genealógico familiar',
        start_url: '/',
        display: 'standalone',
        theme_color: '#1b4332',
        background_color: '#faf6ef',
        icons: [
          { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // No custom runtime caching for the API here on purpose: this app's
      // whole point is showing the current state of someone's family
      // tree, and a rule that silently serves yesterday's data while
      // offline would be worse than just failing.
      //
      // navigateFallbackDenylist: in dev the backend runs on a different
      // origin, so workbox's default navigateFallback (serving the
      // precached index.html for any same-origin *navigation*, so React
      // Router can take over on a direct/offline load of e.g. /tree/:id)
      // never applied to it. In production the single combined image
      // serves both from the same origin, so without this denylist the
      // service worker hijacks full-page navigations to backend routes —
      // "Continuar con Google" (/auth/google), GEDCOM/CSV export and
      // template links, PDF reports — and serves the cached app shell
      // instead of ever letting the browser reach the real endpoint
      // (React Router then renders nothing for that path: a blank page).
      // The frontend's own SPA route is /tree/:id (singular), so it's
      // unaffected by denylisting /trees/ (plural, backend-only).
      workbox: {
        navigateFallbackDenylist: [/^\/auth\//, /^\/trees\//, /^\/uploads\//],
        // heic2any's WASM-backed decoder chunk is sizable and only loaded
        // on demand (see heic.ts) when someone actually picks a HEIC
        // photo — excluding it from the precache manifest keeps every
        // other install/update from downloading it upfront for nothing.
        globIgnores: ['**/heic2any-*.js'],
      },
    }),
  ],
})
