import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Beat Drew is a local-first PWA. The only network use is serving this static
// shell; the service worker precaches it so the app is fully functional offline
// after first load. No backend, no analytics, no external CDNs.
export default defineConfig({
  // Relative base so the build also works under a GitHub Pages sub-path.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Beat Drew',
        short_name: 'Beat Drew',
        description:
          'A daily confrontation with Drew — gamified real-world improvement across Health, Wealth, and Relationships.',
        theme_color: '#0a0a0b',
        background_color: '#0a0a0b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-192-maskable.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
