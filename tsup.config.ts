import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['better-sqlite3'],
  outDir: 'dist',
  onSuccess: async () => {
    const { copyFileSync, mkdirSync } = await import('node:fs');
    mkdirSync('dist', { recursive: true });
    copyFileSync('src/store/schema.sql', 'dist/schema.sql');
  },
});
