import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function extractTypeUnion(source: string, typeName: string): string[] {
  const lines = source.split('\n');
  for (const line of lines) {
    if (line.includes(`type ${typeName}`) && line.includes('=')) {
      const values = line.match(/'([^']+)'/g);
      return values?.map(s => s.replace(/'/g, '')) ?? [];
    }
  }
  return [];
}

describe('UI type alignment with backend', () => {
  it('UI TaskStatus matches backend TaskStatus', () => {
    const root = process.cwd();
    const backendSource = fs.readFileSync(
      path.join(root, 'src', 'types', 'task.ts'),
      'utf-8',
    );
    const uiSource = fs.readFileSync(
      path.join(root, 'src', 'ui', 'src', 'types.ts'),
      'utf-8',
    );

    const backendStatuses = extractTypeUnion(backendSource, 'TaskStatus');
    const uiStatuses = extractTypeUnion(uiSource, 'TaskStatus');

    expect(backendStatuses.length).toBeGreaterThan(0);
    expect(uiStatuses.length).toBeGreaterThan(0);

    for (const status of backendStatuses) {
      expect(uiStatuses, `UI is missing backend status '${status}'`).toContain(status);
    }
  });

  it('UI TaskType matches backend TaskType', () => {
    const root = process.cwd();
    const backendSource = fs.readFileSync(
      path.join(root, 'src', 'types', 'task.ts'),
      'utf-8',
    );
    const uiSource = fs.readFileSync(
      path.join(root, 'src', 'ui', 'src', 'types.ts'),
      'utf-8',
    );

    const backendTypes = extractTypeUnion(backendSource, 'TaskType');
    const uiTypes = extractTypeUnion(uiSource, 'TaskType');

    expect(backendTypes.length).toBeGreaterThan(0);
    expect(uiTypes.length).toBeGreaterThan(0);

    for (const type of backendTypes) {
      expect(uiTypes, `UI is missing backend type '${type}'`).toContain(type);
    }
    for (const type of uiTypes) {
      expect(backendTypes, `UI has stale type '${type}' not in backend`).toContain(type);
    }
  });

  it('UI Priority matches backend Priority', () => {
    const root = process.cwd();
    const backendSource = fs.readFileSync(
      path.join(root, 'src', 'types', 'task.ts'),
      'utf-8',
    );
    const uiSource = fs.readFileSync(
      path.join(root, 'src', 'ui', 'src', 'types.ts'),
      'utf-8',
    );

    const backendPriorities = extractTypeUnion(backendSource, 'Priority');
    const uiPriorities = extractTypeUnion(uiSource, 'TaskPriority');

    expect(backendPriorities.length).toBeGreaterThan(0);
    expect(uiPriorities.length).toBeGreaterThan(0);

    for (const p of backendPriorities) {
      expect(uiPriorities, `UI is missing backend priority '${p}'`).toContain(p);
    }
    for (const p of uiPriorities) {
      expect(backendPriorities, `UI has stale priority '${p}' not in backend`).toContain(p);
    }
  });

  it('UI TaskStatus does not contain statuses absent from backend', () => {
    const root = process.cwd();
    const backendSource = fs.readFileSync(
      path.join(root, 'src', 'types', 'task.ts'),
      'utf-8',
    );
    const uiSource = fs.readFileSync(
      path.join(root, 'src', 'ui', 'src', 'types.ts'),
      'utf-8',
    );

    const backendStatuses = extractTypeUnion(backendSource, 'TaskStatus');
    const uiStatuses = extractTypeUnion(uiSource, 'TaskStatus');

    for (const status of uiStatuses) {
      expect(backendStatuses, `UI has stale status '${status}' not in backend`).toContain(status);
    }
  });

  it('BoardView COLUMNS use todo not queued for initial status', () => {
    const root = process.cwd();
    const boardSource = fs.readFileSync(
      path.join(root, 'src', 'ui', 'src', 'views', 'BoardView.tsx'),
      'utf-8',
    );

    expect(boardSource).toContain("status: 'todo'");
    expect(boardSource).not.toContain("status: 'queued'");
  });
});
