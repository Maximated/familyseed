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
      // 'prompt', not 'autoUpdate': in autoUpdate mode the plugin's
      // register code (virtual:pwa-register, which useRegisterSW wraps)
      // reloads the page itself the moment a new worker activates — with
      // no warning and no regard for whatever the user is doing — and
      // never reports needRefresh, so UpdateAvailableBanner.tsx could
      // never show. Reported twice as the app "throwing the user out" of
      // a half-filled person form a minute after a fresh deploy landed
      // (the new worker installs in the background after launch, then
      // activates and reloads). In 'prompt' mode the new worker waits,
      // the banner appears, and the reload only happens when the user
      // taps it. injectRegister: null keeps the plugin from also injecting
      // its own register script alongside the banner's.
      registerType: 'prompt',
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
