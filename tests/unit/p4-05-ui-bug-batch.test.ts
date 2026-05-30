/**
 * P4-05 UI bug batch (B1–B5) — source-inspection tests, consistent with the
 * project's existing UI test convention (read source, assert structure).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const uiSrc = path.join(process.cwd(), 'src', 'ui', 'src');
const read = (rel: string): string => fs.readFileSync(path.join(uiSrc, rel), 'utf-8');

describe('P4-05 B1 — platform-aware modifier key', () => {
  it('platform.ts detects Mac and exports a MOD glyph (⌘ vs Ctrl)', () => {
    const src = read('lib/platform.ts');
    expect(src).toMatch(/navigator\.platform/);
    expect(src).toContain('⌘');
    expect(src).toContain('Ctrl');
    expect(src).toMatch(/export const MOD/);
  });
  it('Nav and BrainDumpView use MOD instead of a hardcoded ⌘', () => {
    expect(read('components/Nav.tsx')).toContain('{MOD}');
    expect(read('views/BrainDumpView.tsx')).toContain('{MOD}');
  });
});

describe('P4-05 B2 — focus mode widens Today (scoped, not global)', () => {
  it('App gates full width to FULL_WIDTH_VIEWS or focus-mode-on-today only', () => {
    const src = read('App.tsx');
    expect(src).toContain("focusMode && view === 'today'");
    // must NOT widen every view in focus mode
    expect(src).not.toMatch(/data-width=\{\(FULL_WIDTH_VIEWS\.has\(view\) \|\| focusMode\)/);
  });
});

describe('P4-05 B3 — TaskCard menu portal + outside/Escape dismiss', () => {
  it('menu renders via portal and dismisses on pointerdown + Escape', () => {
    const src = read('components/TaskCard.tsx');
    expect(src).toContain('createPortal');
    expect(src).toContain("addEventListener('pointerdown'");
    expect(src).toMatch(/Escape/);
  });
});

describe('P4-05 B4 — committed-today row opens the peek panel', () => {
  it('committed TaskCard onClick calls handleOpenDetail (not just select)', () => {
    const src = read('views/TodayView.tsx');
    // the committed list onClick both selects and opens detail
    expect(src).toMatch(/onClick=\{\(\) => \{\s*onSelectTask\?\.\(task\.id\)\s*handleOpenDetail\(task\)/);
  });
});

describe('P4-05 B5 — row separation + readable status history', () => {
  it('committed list has visible row separation', () => {
    const src = read('views/TodayView.tsx');
    expect(src).toMatch(/space-y-2"[\s\S]*committedList\.map/);
  });
  it('status history uses readable text-sm / space-y-3', () => {
    const src = read('components/TaskPanel.tsx');
    expect(src).toContain('space-y-3');
    expect(src).toContain('text-sm');
  });
});
