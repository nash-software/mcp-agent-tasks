/// <reference lib="webworker" />
// ^ vite's glob-import types (importGlob.d.ts) reference the `Worker` global; this
//   file-scoped lib ref provides it without polluting the Node tsconfig's `lib` (codex P5-01 F2).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
  ],
  base: './',
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
})
