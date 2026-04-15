import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', cli: 'src/cli.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['better-sqlite3'],
  outDir: 'dist',
  onSuccess: async () => {
    const { copyFileSync, mkdirSync, existsSync } = await import('node:fs');
    mkdirSync('dist', { recursive: true });
    if (existsSync('src/ui/index.html')) {
      copyFileSync('src/ui/index.html', 'dist/ui.html');
      console.log('[tsup] Copied src/ui/index.html → dist/ui.html');
    }
  },
});
