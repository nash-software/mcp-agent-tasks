/**
 * P5-04 — New-task modal + guarded delete. Source-inspection (RTL is not available in this project).
 * Behavioural backend coverage is in tests/integration/delete-task.test.ts (create durability, DELETE
 * markdown-first + no-resurrect, 400/404). These assert the UI wiring per ACs 1, 2, 6, 7.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const uiSrc = path.join(process.cwd(), 'src', 'ui', 'src');
const readUi = (rel: string): string => fs.readFileSync(path.join(uiSrc, rel), 'utf-8');

describe('P5-04 — New-task modal + guarded delete', () => {
  it('AC1: NewTaskModal has the six fields and creates via createTask + invalidates', () => {
    const src = readUi('components/NewTaskModal.tsx');
    for (const label of ['Title', 'Project', 'Priority', 'Area', 'Estimate', 'Why']) {
      expect(src).toContain(label);
    }
    expect(src).toContain('createTask');
    expect(src).toContain("queryKey: ['tasks']");
    expect(src).toContain("queryKey: ['today']");
  });

  it('AC2: NewTaskModal blocks submit without title/project and surfaces errors', () => {
    const src = readUi('components/NewTaskModal.tsx');
    expect(src).toContain('Title and project are required');
    expect(src).toContain('setErrorMsg');
    // submit disabled until valid
    expect(src).toMatch(/canSubmit/);
  });

  it('AC1: App wires the modal + a "New task" command + Nav trigger', () => {
    const app = readUi('App.tsx');
    expect(app).toContain('NewTaskModal');
    expect(app).toContain('newTaskOpen');
    expect(app).toContain('onNewTask');
    expect(app).toMatch(/create-new-task/);
    const nav = readUi('components/Nav.tsx');
    expect(nav).toContain('onNewTask');
    expect(nav).toContain('New task');
  });

  it('AC6/AC7: TaskPanel has a guarded two-step delete wired to deleteTask', () => {
    const src = readUi('components/TaskPanel.tsx');
    expect(src).toContain('deleteTask');
    expect(src).toContain('confirmDelete');
    expect(src).toContain('Confirm delete');
    // first action arms (setConfirmDelete(true)); only confirm calls handleDelete
    expect(src).toMatch(/setConfirmDelete\(true\)/);
    expect(src).toMatch(/handleDelete/);
  });
});
