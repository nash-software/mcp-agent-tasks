/**
 * P5-08 — build hygiene. The root `build` script must compile only (no embedded UI `ci`), so a local
 * build is non-destructive; `build:ui` keeps the from-scratch install+build path; CI installs UI deps
 * in its own dedicated step.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'),
) as { scripts: Record<string, string> };

describe('P5-08 — build hygiene', () => {
  it('AC1: `build` compiles only — no embedded UI `ci`', () => {
    expect(pkg.scripts.build).toBe('tsup && npm --prefix src/ui run build');
    expect(pkg.scripts.build).not.toMatch(/src\/ui ci/);
  });

  it('AC3: `build:ui` keeps the from-scratch install+build path', () => {
    expect(pkg.scripts['build:ui']).toMatch(/src\/ui ci/);
    expect(pkg.scripts['build:ui']).toMatch(/src\/ui run build/);
  });

  it('AC4: CI installs UI deps in exactly one dedicated step, before build', () => {
    const ci = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf-8');
    // Exactly one `npm --prefix src/ui ci` — the dedicated step; the build no longer embeds it, so it
    // can't run twice (AC4: "runs once before build, not embedded in build").
    const installSteps = ci.match(/npm --prefix src\/ui ci/g) ?? [];
    expect(installSteps).toHaveLength(1);
    // and it precedes the `npm run build` step
    expect(ci.indexOf('src/ui ci')).toBeLessThan(ci.indexOf('npm run build'));
  });
});
