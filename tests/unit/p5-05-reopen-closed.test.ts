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

  it('AC5/AC6: closed tasks offer Reopen/Resume via the engine, optimistic via transitionTask (MCPAT-061)', () => {
    // MCPAT-061 replaced the discrete Reopen/Resume buttons with the engine-driven footer. The capability
    // is unchanged — closed's primary is Reopen (→todo) and its secondary is Resume (→in_progress) — but
    // the labels now live in the engine (transitionLabel), and the panel routes through handleTransition.
    const actions = readUi('lib/task-actions.ts');
    expect(actions).toContain("from === 'closed' ? 'Reopen'"); // closed → todo
    expect(actions).toContain("'Resume'");                      // closed/blocked → in_progress
    expect(actions).toMatch(/closed:\s*'todo'/);                // primaryTarget(closed) = todo (Reopen)

    const src = readUi('components/TaskPanel.tsx');
    expect(src).toContain('handleTransition');
    expect(src).toContain('primaryTarget');
    // optimistic: snapshot + rollback on error
    expect(src).toMatch(/getQueriesData/);
    expect(src).toMatch(/setQueryData/);
  });
});
