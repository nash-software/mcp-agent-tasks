import { defineConfig } from 'vitest/config';
import { VitestReporter } from 'tdd-guard-vitest';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    reporters: ['default', new VitestReporter()],
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
