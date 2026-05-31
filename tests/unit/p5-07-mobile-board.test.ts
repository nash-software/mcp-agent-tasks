/**
 * P5-07 — mobile board. The touch-drag-vs-scroll and viewport-reflow behaviors are interaction/visual
 * (Playwright); these source-inspection checks lock in the falsifiable structural ACs (AC1, AC4) since
 * RTL/dnd-kit touch simulation isn't available here.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const board = fs.readFileSync(
  path.join(process.cwd(), 'src', 'ui', 'src', 'views', 'BoardView.tsx'),
  'utf-8',
);

describe('P5-07 — mobile board', () => {
  it('AC1: TouchSensor is registered with a delay activation constraint, alongside PointerSensor', () => {
    expect(board).toContain('TouchSensor');
    expect(board).toMatch(/useSensor\(TouchSensor,\s*\{\s*activationConstraint:\s*\{\s*delay:/);
    // PointerSensor (desktop + peek-on-click) is retained
    expect(board).toMatch(/useSensor\(PointerSensor/);
  });

  it('AC4: the inline 4-column grid is replaced by a responsive Tailwind class', () => {
    // no inline gridTemplateColumns repeat(4 — media queries/classes can't override inline styles
    expect(board).not.toMatch(/repeat\(4/);
    // responsive ladder present
    expect(board).toMatch(/grid-cols-1 sm:grid-cols-2 lg:grid-cols-4/);
  });
});
