import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'KHALED CUT AI',
          short_name: 'KhaledCut',
          description: 'Local-first mobile video editor (FFmpeg.wasm).',
          theme_color: '#0b0f17',
          background_color: '#0b0f17',
          display: 'standalone',
          start_url: env.VITE_BASE_PATH || '/',
          lang: 'ar',
          dir: 'rtl',
          icons: [
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
          ]
        },
        workbox: {
          // The phone build has limited memory: skip the extra terser pass on the
          // generated service worker (the app bundle itself is still minified).
          mode: 'development',
          globPatterns: ['**/*.{js,css,html,svg,ico,png,webmanifest}'],
          navigateFallback: 'index.html',
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
          runtimeCaching: [
            {
              // Cache the FFmpeg.wasm core so editing keeps working offline after first use.
              urlPattern: /^https:\/\/unpkg\.com\/@ffmpeg\/core@[^/]+\/.*/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'ffmpeg-core-v1',
                expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 180 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        devOptions: { enabled: false }
      })
    ],
    server: {
      host: '0.0.0.0',
      port: 5173,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
      }
    },
    preview: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
      }
    },
    worker: { format: 'es' },
    build: { target: 'es2022', sourcemap: true, assetsInlineLimit: 4096 },
    test: { environment: 'node' },
  };
});
