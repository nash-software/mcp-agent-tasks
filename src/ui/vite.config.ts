/// <reference lib="webworker" />
// ^ vite's glob-import types (importGlob.d.ts) reference the `Worker` global; this
//   file-scoped lib ref provides it without polluting the Node tsconfig's `lib` (codex P5-01 F2).
/// <reference path="./unconfig-types.d.ts" />
// ^ Workaround for unconfig@7.x type bug: `Args` referenced without import in generated .d.mts.
//   Provides a global ambient declaration for `Args` visible to tsconfig.node.json checks.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { PWA_MANIFEST, WORKBOX_OPTIONS } from './src/lib/pwa-config'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      manifest: PWA_MANIFEST,
      workbox: WORKBOX_OPTIONS,
    }),
  ],
  base: './',
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
})
