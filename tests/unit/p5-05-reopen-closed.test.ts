/**
 * P5-05 — reopen closed + interactive Completed. Server/client state-machine edges are covered
 * behaviorally (tests/unit/types.test.ts, tests/integration/mutation-endpoints.test.ts). These assert
 * the UI wiring (RTL unavailable): clickable Completed rows + the panel Reopen affordance.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const uiSrc = path.join(process.cwd(), 'src', 'ui', 'src');
const readUi = (rel: string): string => fs.readFileSync(path.join(uiSrc, rel), 'utf-8');

describe('P5-05 — reopen closed + interactive Completed', () => {
  it('client transition mirror matches server: closed → todo|in_progress', () => {
    const src = readUi('lib/transitions.ts');
    expect(src).toMatch(/closed:\s*\['todo',\s*'in_progress'\]/);
  });

  it('AC4: CompletedView rows are clickable and open the panel', () => {
    const src = readUi('views/CompletedView.tsx');
    expect(src).toContain('onOpenPanel');
    // rows render a button (not an inert <li>) wired to open the panel
    expect(src).toMatch(/onClick=\{\(\) => onOpenPanel\(/);
    const app = readUi('App.tsx');
    expect(app).toContain('CompletedView onOpenPanel={setPanel}');
  });

  it('AC5/AC6: TaskPanel shows Reopen/Resume for closed tasks, optimistic via transitionTask', () => {
    const src = readUi('components/TaskPanel.tsx');
    expect(src).toContain('canReopen');
    expect(src).toContain("task.status === 'closed'");
    expect(src).toContain('handleReopen');
    expect(src).toContain('Reopen');
    expect(src).toContain('Resume');
    // optimistic: snapshot + rollback on error
    expect(src).toMatch(/getQueriesData/);
  });
});
