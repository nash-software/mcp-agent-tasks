/**
 * PWA configuration module — manifest fields and runtime caching rules.
 *
 * Exported as plain objects (no vite-plugin-pwa type imports) so that:
 *  1. This module is safe to import in tests without the vite build toolchain.
 *  2. The manifest fields and runtimeCaching rules are unit-assertable.
 *
 * Design tokens sourced from tailwind.config.js:
 *   bg: '#09090B'   (background_color)
 *   accent: '#0070F3' (theme_color — brand colour)
 */

export const THEME_COLOR = '#0070F3'
export const BACKGROUND_COLOR = '#09090B'

/** Web app manifest fields. */
export const PWA_MANIFEST = {
  name: 'Agent Tasks',
  short_name: 'Tasks',
  description: 'AI-agent task management dashboard',
  display: 'standalone' as const,
  start_url: '/',
  scope: '/',
  theme_color: THEME_COLOR,
  background_color: BACKGROUND_COLOR,
  icons: [
    {
      src: '/icons/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any' as const,
    },
    {
      src: '/icons/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any' as const,
    },
    {
      src: '/icons/icon-512-maskable.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable' as const,
    },
  ],
}

/**
 * Runtime caching rules for Workbox.
 *
 * Rules are evaluated first-match-wins (Workbox order).
 * - /api/version  → NetworkOnly   (version poll must never return stale data)
 * - /api/dev/*    → NetworkOnly   (dev-only endpoints, never cache)
 * - /api/*        → NetworkFirst  (task data: try network, fall back to cache)
 */
export const RUNTIME_CACHING = [
  {
    // /api/version must NEVER be served from cache — it drives the update-check loop
    urlPattern: /\/api\/version(?:$|\?)/,
    handler: 'NetworkOnly' as const,
  },
  {
    // /api/dev/* endpoints are dev-only; never cache them
    urlPattern: /\/api\/dev\//,
    handler: 'NetworkOnly' as const,
  },
  {
    // All other /api/* requests: network-first so task data is always fresh,
    // but falls back to cached response when offline
    urlPattern: /\/api\//,
    handler: 'NetworkFirst' as const,
    options: {
      cacheName: 'api-cache',
      networkTimeoutSeconds: 5,
      expiration: {
        maxEntries: 50,
        maxAgeSeconds: 60 * 60 * 24, // 24 h
      },
      cacheableResponse: {
        statuses: [0, 200],
      },
    },
  },
]

/** Workbox options for vite-plugin-pwa (assembled inline in vite.config.ts). */
export const WORKBOX_OPTIONS = {
  globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  navigateFallbackDenylist: [/\/api\/version/, /\/api\/dev\//],
  runtimeCaching: RUNTIME_CACHING,
}
