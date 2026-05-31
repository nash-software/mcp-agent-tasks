/**
 * P5-09 — daily-use bug sweep. Source-inspection tests (consistent with this project's UI test
 * pattern) covering the four fixes: open-detail from every Today section, Today bucket exclusivity,
 * GEN in /api/projects, and the Ctrl+K hint separator.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const uiSrc = path.join(root, 'src', 'ui', 'src');
const readUi = (rel: string): string => fs.readFileSync(path.join(uiSrc, rel), 'utf-8');
const readSrc = (rel: string): string => fs.readFileSync(path.join(root, 'src', rel), 'utf-8');

describe('P5-09 — daily-use bug sweep', () => {
  // AC1 — detail opens from every Today section
  it('AC1: every Today section onClick that selects also opens detail', () => {
    const src = readUi('views/TodayView.tsx');
    // The candidate/draft rows used to call only onSelectTask; they must now also handleOpenDetail.
    // No onClick may select without opening detail.
    const selectOnly = /onClick=\{\(\) => onSelectTask\?\.\(task\.id\)\}/.test(src);
    expect(selectOnly).toBe(false);
    // At least three sections (committed, needs-your-call, candidates) chain both calls.
    const chained = src.match(/onSelectTask\?\.\(task\.id\)[^}]*handleOpenDetail\(task\)/g) ?? [];
    expect(chained.length).toBeGreaterThanOrEqual(3);
  });

  // AC2 — buckets are mutually exclusive (committed excludes drafts)
  it('AC2: committed list excludes draft tasks so an id never renders in two buckets', () => {
    const src = readUi('views/TodayView.tsx');
    expect(src).toContain("t.status !== 'draft'");
  });

  // AC3 — GEN appears in /api/projects
  it('AC3: /api/projects appends the global GEN project from projectIndexes', () => {
    const src = readSrc('server-ui.ts');
    expect(src).toMatch(/projectIndexes\.find\(p => p\.prefix === 'GEN'\)/);
    expect(src).toMatch(/projects\.push\(\{ prefix: 'GEN'/);
  });

  // AC4 — Ctrl+K separator
  it('AC4: Nav search hint includes the + separator', () => {
    expect(readUi('components/Nav.tsx')).toContain('{MOD}+K');
  });
});
