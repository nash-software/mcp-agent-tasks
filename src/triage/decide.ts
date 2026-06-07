/**
 * Pure Tier-0 decision logic. No git, no gh, no store — deterministic over a
 * Task + MergeEvidence so it is exhaustively unit-testable.
 */
import type { Task, TaskStatus } from '../types/task.js';
import { VALID_TRANSITIONS } from '../types/transitions.js';
import type { MergeEvidence, TriageOutcome } from './types.js';

const OPEN_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'todo', 'in_progress', 'blocked', 'draft', 'approved',
]);

const HOUR_MS = 3600_000;
const DEFAULT_FRESH_MS = 24 * HOUR_MS;

/**
 * Shortest legal transition path from `from` to `to` (inclusive of both ends),
 * via VALID_TRANSITIONS. Returns null when `to` is unreachable.
 */
export function transitionPath(from: TaskStatus, to: TaskStatus): TaskStatus[] | null {
  if (from === to) return [from];
  const queue: TaskStatus[][] = [[from]];
  const seen = new Set<TaskStatus>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1]!;
    for (const next of VALID_TRANSITIONS[last]) {
      if (seen.has(next)) continue;
      const extended = [...path, next];
      if (next === to) return extended;
      seen.add(next);
      queue.push(extended);
    }
  }
  return null;
}

export interface DecideOpts {
  /** Window during which a SOFT-evidence task is considered too fresh to auto-resolve. */
  freshMs?: number;
}

function lastTouchedMs(task: Task): number {
  const u = Date.parse(task.updated);
  const a = Date.parse(task.last_activity);
  return Math.max(Number.isNaN(u) ? 0 : u, Number.isNaN(a) ? 0 : a);
}

function isClaimActive(task: Task, nowMs: number): boolean {
  if (!task.claimed_by || !task.claimed_at) return false;
  const claimedMs = Date.parse(task.claimed_at);
  if (Number.isNaN(claimedMs)) return false;
  return claimedMs + task.claim_ttl_hours * HOUR_MS > nowMs;
}

/**
 * Decide whether an OPEN task with the given merge evidence should be resolved to `done`.
 * Conservative: hard evidence (live git/gh) resolves through the fresh window, but an
 * active claim always defers; soft (stored-state) evidence additionally defers when the
 * task was touched recently.
 */
export function decideTier0(
  task: Task,
  evidence: MergeEvidence,
  nowMs: number,
  opts: DecideOpts = {},
): TriageOutcome {
  const skip = (reason: import('./types.js').SkipReason, detail: string): TriageOutcome =>
    ({ taskId: task.id, project: task.project, reason, detail });

  if (!OPEN_STATUSES.has(task.status)) return skip('not-open', `status is ${task.status}`);
  if (!evidence.resolved) {
    return skip(evidence.signal === 'open-pr' ? 'open-pr' : 'no-signal', evidence.detail || 'no merge evidence');
  }
  if (isClaimActive(task, nowMs)) return skip('claimed-active', `claimed by ${task.claimed_by}`);
  if (!evidence.hard) {
    const freshMs = opts.freshMs ?? DEFAULT_FRESH_MS;
    if (nowMs - lastTouchedMs(task) < freshMs) {
      return skip('fresh', `soft evidence + touched within ${Math.round(freshMs / HOUR_MS)}h`);
    }
  }

  const path = transitionPath(task.status, 'done');
  if (!path) return skip('no-path', `no transition path ${task.status} → done`);

  return {
    taskId: task.id,
    project: task.project,
    fromStatus: task.status,
    toStatus: 'done',
    path,
    tier: 0,
    signal: evidence.signal,
    detail: evidence.detail,
    evidenceHard: evidence.hard,
  };
}
