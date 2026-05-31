/**
 * P5-09 — daily-use bug sweep. Source-inspection checks for the two inherently-presentational fixes
 * (JSX onClick wiring + a label string) — RTL is not available in this project. The behavioural fixes
 * are tested directly against their extracted pure functions:
 *   - AC2 (bucket exclusivity) → tests/unit/today-buckets.test.ts (isCommittedBucket)
 *   - AC3 (GEN in /api/projects) → tests/unit/projects-list.test.ts (buildProjectsList)
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const uiSrc = path.join(process.cwd(), 'src', 'ui', 'src');
const readUi = (rel: string): string => fs.readFileSync(path.join(uiSrc, rel), 'utf-8');

describe('P5-09 — daily-use bug sweep (presentational)', () => {
  // AC1 — detail opens from every Today section
  it('AC1: no Today row selects without also opening detail; ≥3 sections chain both', () => {
    const src = readUi('views/TodayView.tsx');
    // The candidate/draft rows used to call only onSelectTask; none may anymore.
    const selectOnly = /onClick=\{\(\) => onSelectTask\?\.\(task\.id\)\}/.test(src);
    expect(selectOnly).toBe(false);
    // Committed + needs-your-call + candidates all chain onSelectTask → handleOpenDetail.
    const chained = src.match(/onSelectTask\?\.\(task\.id\)[^}]*handleOpenDetail\(task\)/g) ?? [];
    expect(chained.length).toBeGreaterThanOrEqual(3);
  });

  // AC4 — Ctrl+K separator
  it('AC4: Nav search hint includes the + separator', () => {
    expect(readUi('components/Nav.tsx')).toContain('{MOD}+K');
  });
});
