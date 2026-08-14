import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
      // offline would be worse than just failing. The backend also runs
      // on a different origin, so workbox's default navigateFallback
      // (serving the precached index.html for any same-origin route, so
      // React Router can take over on a direct/offline load of e.g.
      // /tree/:id) never even applies to it — nothing to exclude.
    }),
  ],
})
