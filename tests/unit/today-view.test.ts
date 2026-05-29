/**
 * UI unit tests for TodayView and useToday hook.
 * Uses source-file analysis (consistent with existing test patterns in this project).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const uiSrc = path.join(root, 'src', 'ui', 'src');

function readUiFile(relPath: string): string {
  return fs.readFileSync(path.join(uiSrc, relPath), 'utf-8');
}

describe('TodayView.tsx — source structure', () => {
  it('imports useToday hook', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('useToday');
  });

  it('renders committed tasks section', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('Committed');
  });

  it('renders candidate queue section', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('Queue');
  });

  it('renders empty state for committed section', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('Nothing committed yet');
  });

  it('renders empty state for candidates section', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('All caught up!');
  });

  it('renders capacity gauge component', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('CapacityGauge');
  });

  it('groups tasks by area', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('groupByArea');
  });

  it('handles loading state', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('isLoading');
  });

  it('handles error state', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('error');
  });

  it('has remove-from-today button', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('removeFromToday');
  });

  it('has commit-to-today button', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('scheduleForToday');
  });
});

describe('TodayView.tsx — capacity gauge colour logic', () => {
  it('uses red colour class for over-target', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('bg-red-500');
  });

  it('uses amber colour class for 80–100% range', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('bg-amber-500');
  });

  it('uses green colour class when under target', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('bg-emerald-500');
  });
});

describe('useToday.ts — source structure', () => {
  it('uses TanStack Query useQuery', () => {
    expect(readUiFile('hooks/useToday.ts')).toContain('useQuery');
  });

  it('sets staleTime to 15000', () => {
    expect(readUiFile('hooks/useToday.ts')).toContain('staleTime: 15000');
  });

  it('polls every 30 seconds', () => {
    expect(readUiFile('hooks/useToday.ts')).toContain('refetchInterval: 30000');
  });

  it('exports scheduleForToday helper', () => {
    expect(readUiFile('hooks/useToday.ts')).toContain('scheduleForToday');
  });

  it('exports removeFromToday helper', () => {
    expect(readUiFile('hooks/useToday.ts')).toContain('removeFromToday');
  });
});

describe('api.ts — today endpoints', () => {
  it('exports fetchToday function', () => {
    expect(readUiFile('api.ts')).toContain('fetchToday');
  });

  it('calls /api/today', () => {
    expect(readUiFile('api.ts')).toContain('/api/today');
  });

  it('exports scheduleTask function', () => {
    expect(readUiFile('api.ts')).toContain('scheduleTask');
  });

  it('calls /api/tasks/:id/schedule', () => {
    expect(readUiFile('api.ts')).toContain('/schedule');
  });
});

describe('App.tsx — TodayView integration', () => {
  it('imports TodayView', () => {
    expect(readUiFile('App.tsx')).toContain('TodayView');
  });

  it('defaults to the today tab', () => {
    expect(readUiFile('App.tsx')).toContain("useState<TabId>('today')");
  });

  it('renders TodayView when today tab is active', () => {
    expect(readUiFile('App.tsx')).toContain("activeTab === 'today'");
  });
});

describe('Header.tsx — today tab', () => {
  it('includes today in TabId union', () => {
    expect(readUiFile('components/Header.tsx')).toContain("'today'");
  });

  it('Today tab appears before Board in the TABS array', () => {
    const source = readUiFile('components/Header.tsx');
    const todayIdx = source.indexOf("id: 'today'");
    const boardIdx = source.indexOf("id: 'board'");
    expect(todayIdx).toBeGreaterThanOrEqual(0);
    expect(todayIdx).toBeLessThan(boardIdx);
  });
});
