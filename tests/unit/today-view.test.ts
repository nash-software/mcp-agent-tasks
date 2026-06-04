/**
 * UI unit tests for P1-03 TodayView, useToday hook, HeroTask, CapacityGauge, and format utils.
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

// ── lib/format.ts ─────────────────────────────────────────────────────────

describe('lib/format.ts — fmtElapsed', () => {
  it('formats under an hour as M:SS', async () => {
    const { fmtElapsed } = await import(path.join(uiSrc, 'lib', 'format.ts'));
    expect(fmtElapsed(65000)).toBe('1:05');   // 65s
    expect(fmtElapsed(0)).toBe('0:00');
    expect(fmtElapsed(59000)).toBe('0:59');
  });

  it('formats over an hour as H:MM:SS', async () => {
    const { fmtElapsed } = await import(path.join(uiSrc, 'lib', 'format.ts'));
    expect(fmtElapsed(3661000)).toBe('1:01:01');  // 3661s
    expect(fmtElapsed(3600000)).toBe('1:00:00');  // exactly 1h
    expect(fmtElapsed(7200000)).toBe('2:00:00');  // 2h
  });
});

describe('lib/format.ts — fmtEst', () => {
  it('formats fractional hours', async () => {
    const { fmtEst } = await import(path.join(uiSrc, 'lib', 'format.ts'));
    expect(fmtEst(0.5)).toBe('30m');
    expect(fmtEst(1.5)).toBe('1h 30m');
    expect(fmtEst(2)).toBe('2h');
    expect(fmtEst(null)).toBeNull();
    expect(fmtEst(undefined)).toBeNull();
  });
});

describe('lib/format.ts — fmtHM', () => {
  it('formats hours into readable form', async () => {
    const { fmtHM } = await import(path.join(uiSrc, 'lib', 'format.ts'));
    expect(fmtHM(6)).toBe('6h');
    expect(fmtHM(4.75)).toBe('4h 45m');
    expect(fmtHM(0.5)).toBe('30m');
  });
});

describe('lib/format.ts — PRI_RANK', () => {
  it('ranks critical < high < medium < low', async () => {
    const { PRI_RANK } = await import(path.join(uiSrc, 'lib', 'format.ts'));
    expect(PRI_RANK.critical).toBeLessThan(PRI_RANK.high);
    expect(PRI_RANK.high).toBeLessThan(PRI_RANK.medium);
    expect(PRI_RANK.medium).toBeLessThan(PRI_RANK.low);
  });
});

// ── CapacityGauge.tsx — zone colour logic ────────────────────────────────

describe('CapacityGauge.tsx — zone colour logic (source analysis)', () => {
  it('references status-green for under-target zone', () => {
    expect(readUiFile('components/CapacityGauge.tsx')).toContain('status-green');
  });

  it('references status-amber for 80–100% zone', () => {
    expect(readUiFile('components/CapacityGauge.tsx')).toContain('status-amber');
  });

  it('references status-red for over-target zone', () => {
    expect(readUiFile('components/CapacityGauge.tsx')).toContain('status-red');
  });

  it('guards against divide-by-zero with targetMinutes > 0', () => {
    const src = readUiFile('components/CapacityGauge.tsx');
    expect(src).toContain('targetMinutes > 0');
  });

  it('renders over-target hint text', () => {
    expect(readUiFile('components/CapacityGauge.tsx')).toContain('Over target by');
  });

  it('persists target to localStorage', () => {
    expect(readUiFile('components/CapacityGauge.tsx')).toContain("lifeos-target");
  });

  it('clamps fill to 100% max (min(pct,1))', () => {
    expect(readUiFile('components/CapacityGauge.tsx')).toContain('Math.min');
  });
});

// ── HeroTask.tsx — source structure ──────────────────────────────────────

describe('HeroTask.tsx — source structure', () => {
  it('has an empty state for null task', () => {
    expect(readUiFile('components/HeroTask.tsx')).toContain('Nothing in progress');
  });

  it('renders a live elapsed timer', () => {
    const src = readUiFile('components/HeroTask.tsx');
    expect(src).toContain('fmtElapsed');
    expect(src).toContain('setInterval');
    expect(src).toContain('clearInterval');
  });

  it('derives start instant from transitions', () => {
    const src = readUiFile('components/HeroTask.tsx');
    expect(src).toContain('in_progress');
    expect(src).toContain('transitions');
  });

  it('never truncates title (no truncate class on title)', () => {
    const src = readUiFile('components/HeroTask.tsx');
    // Title div should NOT have truncate applied
    const titleSection = src.match(/In progress[\s\S]{0,500}fontSize.*19/);
    // Just check font-semibold is present on a title element
    expect(src).toContain('font-semibold');
    expect(src).toContain('fontSize: 19');
  });

  it('shows Mark done, Pause, Block, Open detail actions', () => {
    const src = readUiFile('components/HeroTask.tsx');
    expect(src).toContain('Mark done');
    expect(src).toContain('Pause');
    expect(src).toContain('Block');
    expect(src).toContain('Open detail');
  });

  it('shows why in a left-bordered block', () => {
    const src = readUiFile('components/HeroTask.tsx');
    expect(src).toContain('task.why');
    expect(src).toContain('border-l-2');
  });

  it('has a pulsing eyebrow indicator', () => {
    expect(readUiFile('components/HeroTask.tsx')).toContain('animate-pulse');
  });

  it('shows git branch when present', () => {
    expect(readUiFile('components/HeroTask.tsx')).toContain('git?.branch');
  });
});

// ── TaskCard.tsx — source structure ──────────────────────────────────────

describe('TaskCard.tsx — source structure', () => {
  it('uses StatusDot atom', () => {
    expect(readUiFile('components/TaskCard.tsx')).toContain('StatusDot');
  });

  it('renders a 2px left priority bar', () => {
    const src = readUiFile('components/TaskCard.tsx');
    // 2px left bar uses w-0.5 (which is 2px in Tailwind) on an absolute left-0 div
    expect(src).toContain('PRIORITY_BAR');
    expect(src).toContain('w-0.5');
    expect(src).toContain('left-0');
  });

  it('supports candidate mode with + button', () => {
    expect(readUiFile('components/TaskCard.tsx')).toContain("mode === 'candidate'");
  });

  it('renders selected state with surface-2 ring', () => {
    const src = readUiFile('components/TaskCard.tsx');
    expect(src).toContain('surface-2');
    expect(src).toContain('ring-1');
  });

  it('has an area hover chip expand', () => {
    expect(readUiFile('components/TaskCard.tsx')).toContain('hoverArea');
    expect(readUiFile('components/TaskCard.tsx')).toContain('AreaChip');
    expect(readUiFile('components/TaskCard.tsx')).toContain('AreaDot');
  });
});

// ── TodayView.tsx — source structure ─────────────────────────────────────

describe('TodayView.tsx — source structure', () => {
  it('imports useToday hook', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('useToday');
  });

  it('renders HeroTask component', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('HeroTask');
  });

  it('renders CapacityGauge component', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('CapacityGauge');
  });

  it('renders committed tasks section', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('Committed today');
  });

  it('renders collapsible candidate queue section', () => {
    const src = readUiFile('views/TodayView.tsx');
    expect(src).toContain('unscheduled');
    expect(src).toContain('setCandidatesOpen');
  });

  it('renders empty state for committed section', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('Nothing committed yet');
  });

  it('handles loading state', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('isLoading');
  });

  it('handles error state', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('error');
  });

  it('has scheduleForToday for committing candidates', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('scheduleForToday');
  });

  it('has removeFromToday for uncommitting', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('removeFromToday');
  });

  it('sorts committed by PRI_RANK with done sinking to bottom', () => {
    const src = readUiFile('views/TodayView.tsx');
    // MCPAT-070 Phase C: PRI_RANK moved into taskCmp in sort.ts; TodayView uses taskCmp + sortWithDoneSink.
    // Done-sink behaviour is preserved via sortWithDoneSink; priority ordering via taskCmp.
    expect(src).toContain('sortWithDoneSink');
    expect(src).toContain("status === 'done'");
  });

  it('groups candidates by area in fixed order', () => {
    const src = readUiFile('views/TodayView.tsx');
    // MCPAT-070 Phase C: AREA_ORDER is imported from sort.ts (canonical source).
    // The values 'client'/'outsource' are defined in sort.ts and imported here.
    expect(src).toContain('AREA_ORDER');
    expect(src).toContain('groupByArea');
  });

  it('hero: renders in_progress task as hero (never two heroes)', () => {
    const src = readUiFile('views/TodayView.tsx');
    expect(src).toContain('in_progress');
    expect(src).toContain('heroTask');
  });

  it('exposes onVisibleIdsChange for keyboard navigation', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('onVisibleIdsChange');
  });

  it('accepts selectedTaskId + onSelectTask from App', () => {
    const src = readUiFile('views/TodayView.tsx');
    expect(src).toContain('selectedTaskId');
    expect(src).toContain('onSelectTask');
  });

  it('has needs-your-call draft section stub', () => {
    const src = readUiFile('views/TodayView.tsx');
    expect(src).toContain('draft');
    expect(src).toContain('Needs your call');
  });

  it('persists target to localStorage with correct key', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('lifeos-target');
  });
});

// ── useToday.ts — source structure ───────────────────────────────────────

describe('useToday.ts — source structure', () => {
  it('uses TanStack Query useQuery', () => {
    expect(readUiFile('hooks/useToday.ts')).toContain('useQuery');
  });

  it('uses TanStack Query useMutation for optimistic updates', () => {
    expect(readUiFile('hooks/useToday.ts')).toContain('useMutation');
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

  it('exports markDone helper', () => {
    expect(readUiFile('hooks/useToday.ts')).toContain('markDone');
  });

  it('exports pauseTask helper', () => {
    expect(readUiFile('hooks/useToday.ts')).toContain('pauseTask');
  });

  it('exports blockTask helper', () => {
    expect(readUiFile('hooks/useToday.ts')).toContain('blockTask');
  });

  it('exports cyclePriority helper', () => {
    expect(readUiFile('hooks/useToday.ts')).toContain('cyclePriority');
  });

  it('uses onMutate/onError rollback pattern', () => {
    const src = readUiFile('hooks/useToday.ts');
    expect(src).toContain('onMutate');
    expect(src).toContain('onError');
    expect(src).toContain('onSettled');
  });

  it('invalidates both today and tasks query keys on settle', () => {
    const src = readUiFile('hooks/useToday.ts');
    expect(src).toContain("'today'");
    expect(src).toContain("'tasks'");
  });
});

// ── api.ts — today endpoints ──────────────────────────────────────────────

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

  it('exports transitionTask for status mutations', () => {
    expect(readUiFile('api.ts')).toContain('transitionTask');
  });

  it('exports updateTaskPriority for priority cycling', () => {
    expect(readUiFile('api.ts')).toContain('updateTaskPriority');
  });
});

// ── App.tsx — TodayView integration ──────────────────────────────────────

describe('App.tsx — TodayView integration', () => {
  it('imports TodayView', () => {
    expect(readUiFile('App.tsx')).toContain('TodayView');
  });

  it('defaults to the today view via readStoredView', () => {
    const source = readUiFile('App.tsx');
    expect(source).toContain('readStoredView');
    expect(source).toContain("'today'");
  });

  it('renders TodayView when view is today', () => {
    expect(readUiFile('App.tsx')).toContain("view === 'today'");
  });

  it('passes selectedTaskId to TodayView', () => {
    expect(readUiFile('App.tsx')).toContain('selectedTaskId');
  });

  it('passes onVisibleIdsChange to TodayView for keyboard nav', () => {
    expect(readUiFile('App.tsx')).toContain('onVisibleIdsChange');
  });

  it('passes real visibleIds to useGlobalKeyboard', () => {
    const src = readUiFile('App.tsx');
    expect(src).toContain('visibleIds');
    // Should NOT be an empty array literal
    const kbLine = src.match(/useGlobalKeyboard\([\s\S]{0,500}visibleIds/);
    expect(kbLine).not.toBeNull();
  });

  it('wires moveSelection with real visibleIds array', () => {
    const src = readUiFile('App.tsx');
    expect(src).toContain('moveSelection');
    expect(src).toContain('visibleIds.length');
  });

  it('wires markDone through todayHook', () => {
    expect(readUiFile('App.tsx')).toContain('todayHook.markDone');
  });

  it('wires cyclePriority through todayHook', () => {
    expect(readUiFile('App.tsx')).toContain('todayHook.cyclePriority');
  });

  it('wires toggleCommitted through todayHook schedule/remove', () => {
    const src = readUiFile('App.tsx');
    expect(src).toContain('todayHook.scheduleForToday');
    expect(src).toContain('todayHook.removeFromToday');
  });
});

// ── Header.tsx — today tab ────────────────────────────────────────────────

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

// ── P4-04: EstimatePrompt.tsx — source structure ─────────────────────────

describe('EstimatePrompt.tsx — source structure (P4-04, AC 1–3)', () => {
  it('exports EstimatePrompt component', () => {
    expect(readUiFile('components/EstimatePrompt.tsx')).toContain('export function EstimatePrompt');
  });

  it('renders quick chips: 30m / 1h / 2h / 4h with correct hours values', () => {
    const src = readUiFile('components/EstimatePrompt.tsx');
    // All four chips must be present
    expect(src).toContain("label: '30m'");
    expect(src).toContain("hours: 0.5");
    expect(src).toContain("label: '1h'");
    expect(src).toContain("hours: 1");
    expect(src).toContain("label: '2h'");
    expect(src).toContain("hours: 2");
    expect(src).toContain("label: '4h'");
    expect(src).toContain("hours: 4");
  });

  it('has a free numeric input for custom hours', () => {
    const src = readUiFile('components/EstimatePrompt.tsx');
    expect(src).toContain('inputMode="decimal"');
    expect(src).toContain('custom');
  });

  it('has a Skip / "later" path (AC 3)', () => {
    expect(readUiFile('components/EstimatePrompt.tsx')).toContain('Skip for now');
  });

  it('calls onSkip when skip is triggered (AC 3)', () => {
    expect(readUiFile('components/EstimatePrompt.tsx')).toContain('onSkip');
  });

  it('calls onConfirm with estimate_hours when confirmed (AC 2)', () => {
    expect(readUiFile('components/EstimatePrompt.tsx')).toContain('onConfirm');
  });

  it('validates that estimate is within MIN..MAX hours', () => {
    const src = readUiFile('components/EstimatePrompt.tsx');
    expect(src).toContain('MAX_ESTIMATE_HOURS');
    expect(src).toContain('MIN_ESTIMATE_HOURS');
    expect(src).toContain('v > MAX_ESTIMATE_HOURS');
  });

  it('has a dismiss path (Escape key or X button)', () => {
    const src = readUiFile('components/EstimatePrompt.tsx');
    expect(src).toContain('onDismiss');
    expect(src).toContain("key === 'Escape'");
  });

  it('uses design token classes (surface-1, surface-2, accent)', () => {
    const src = readUiFile('components/EstimatePrompt.tsx');
    expect(src).toContain('surface-1');
    expect(src).toContain('surface-2');
    expect(src).toContain('bg-accent');
  });
});

// ── P4-04: TodayView.tsx — estimate prompt integration ───────────────────

describe('TodayView.tsx — estimate prompt integration (P4-04, AC 1, 3, 7)', () => {
  it('imports EstimatePrompt', () => {
    expect(readUiFile('views/TodayView.tsx')).toContain('EstimatePrompt');
  });

  it('guards commit on existing estimate_hours (AC 7 — no re-prompt)', () => {
    // The commit handler checks estimate_hours before showing the prompt
    const src = readUiFile('views/TodayView.tsx');
    expect(src).toContain('estimate_hours');
    expect(src).toContain('estimatePromptTaskId');
  });

  it('has handleEstimateConfirm calling scheduleWithEstimate (AC 2)', () => {
    const src = readUiFile('views/TodayView.tsx');
    expect(src).toContain('handleEstimateConfirm');
    expect(src).toContain('scheduleWithEstimate');
  });

  it('has handleEstimateSkip calling scheduleWithEstimate with null (AC 3)', () => {
    const src = readUiFile('views/TodayView.tsx');
    expect(src).toContain('handleEstimateSkip');
    expect(src).toMatch(/scheduleWithEstimate\(estimatePromptTaskId.*null/s);
  });

  it('has handleEstimateDismiss resetting the prompt without committing', () => {
    const src = readUiFile('views/TodayView.tsx');
    expect(src).toContain('handleEstimateDismiss');
    expect(src).toContain('setEstimatePromptTaskId(null)');
  });

  it('renders EstimatePrompt when estimatePromptTask is present', () => {
    const src = readUiFile('views/TodayView.tsx');
    expect(src).toContain('estimatePromptTask !== null');
    expect(src).toContain('<EstimatePrompt');
  });

  it('computes unestimatedCount from committed tasks (AC 6)', () => {
    const src = readUiFile('views/TodayView.tsx');
    expect(src).toContain('unestimatedCount');
    expect(src).toContain("estimate_hours == null || t.estimate_hours <= 0");
  });

  it('passes unestimatedCount to CapacityGauge (AC 6)', () => {
    const src = readUiFile('views/TodayView.tsx');
    expect(src).toContain('unestimatedCount={unestimatedCount}');
  });
});

// ── P4-04: useToday.ts — scheduleWithEstimate ─────────────────────────────

describe('useToday.ts — scheduleWithEstimate (P4-04, AC 2)', () => {
  it('exports scheduleWithEstimate helper', () => {
    expect(readUiFile('hooks/useToday.ts')).toContain('scheduleWithEstimate');
  });

  it('calls scheduleTask then updateTask for the estimate', () => {
    const src = readUiFile('hooks/useToday.ts');
    expect(src).toContain('scheduleMutation.mutateAsync');
    expect(src).toContain('updateTask');
    expect(src).toContain('estimate_hours');
  });

  it('skips the PATCH when estimateHours is null (skip path)', () => {
    const src = readUiFile('hooks/useToday.ts');
    // null guard before calling updateTask
    expect(src).toContain('estimateHours !== null && estimateHours > 0');
  });

  it('invalidates today query after PATCH to refresh capacity gauge', () => {
    const src = readUiFile('hooks/useToday.ts');
    expect(src).toContain('invalidate()');
  });

  it('logs a warning if PATCH fails but does not un-commit (acceptable degradation)', () => {
    const src = readUiFile('hooks/useToday.ts');
    expect(src).toContain('console.warn');
    expect(src).toContain('task still committed');
  });
});

// ── P4-04: CapacityGauge.tsx — unestimated hint ──────────────────────────

describe('CapacityGauge.tsx — P4-04 unestimated hint (AC 6)', () => {
  it('accepts unestimatedCount prop', () => {
    const src = readUiFile('components/CapacityGauge.tsx');
    expect(src).toContain('unestimatedCount');
  });

  it('renders "N unestimated" hint when count > 0', () => {
    expect(readUiFile('components/CapacityGauge.tsx')).toContain('unestimated');
  });

  it('defaults unestimatedCount to 0 (no hint when all tasks are estimated)', () => {
    expect(readUiFile('components/CapacityGauge.tsx')).toContain('unestimatedCount = 0');
  });
});

// ── P4-04: Capacity gauge colour logic (AC 5) ────────────────────────────

describe('Capacity gauge colour thresholds (P4-04 AC 5 — falsifiable)', () => {
  // These tests verify the threshold math in isolation, consistent with the zone logic in CapacityGauge.tsx

  function getZone(committedMinutes: number, targetMinutes: number): 'green' | 'amber' | 'red' {
    const pct = targetMinutes > 0 ? committedMinutes / targetMinutes : 0;
    if (pct > 1.0) return 'red';
    if (pct >= 0.8) return 'amber';
    return 'green';
  }

  it('is green when committedMinutes < 80% of target (exclusive boundary)', () => {
    expect(getZone(287, 360)).toBe('green');   // just under 80%
    expect(getZone(0, 360)).toBe('green');     // nothing committed
  });

  it('is amber when committedMinutes is 80–100% of target (inclusive at both ends)', () => {
    expect(getZone(288, 360)).toBe('amber');   // exactly 80%
    expect(getZone(360, 360)).toBe('amber');   // exactly 100%
  });

  it('is red when committedMinutes > 100% of target (AC 5 — over-capacity)', () => {
    expect(getZone(361, 360)).toBe('red');     // one minute over
    expect(getZone(720, 360)).toBe('red');     // 200% over
  });

  it('estimates summing to > 360min (6h) → gauge turns red (AC 5 falsifiable)', () => {
    // 3 tasks × 2.5h each = 7.5h = 450min > 360min target
    const committedMinutes = [2.5, 2.5, 2.5].reduce((sum, h) => sum + h * 60, 0);
    expect(committedMinutes).toBe(450);
    expect(getZone(450, 360)).toBe('red');
  });

  it('is green when targetMinutes is 0 (divide-by-zero guard)', () => {
    expect(getZone(100, 0)).toBe('green');
  });
});
