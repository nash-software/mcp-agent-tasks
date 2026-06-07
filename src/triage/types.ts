/**
 * Triage system types (MCPAT-075 / MCPAT-076 Tier 0).
 *
 * Tier 0 = deterministic git reconciliation: resolve any OPEN task that is
 * provably merged (linked PR merged / commit in main / branch merged).
 */
import type { TaskStatus } from '../types/task.js';

/** Merge signal kinds, strongest → weakest. `hard` evidence is verified against
 *  live git/gh; `pr-state-fallback` is the (possibly stale) state stored on the task. */
export type MergeSignal =
  | 'pr-merged'          // gh confirms the linked PR is merged
  | 'commit-in-main'     // a linked commit is an ancestor of origin/main
  | 'branch-merged'      // the linked branch is merged into origin/main
  | 'pr-state-fallback'  // task.git.pr.state === 'merged' (no live verification)
  | 'open-pr'            // linked PR is still open → explicitly NOT resolved
  | 'none';              // no merge evidence at all

export interface MergeEvidence {
  resolved: boolean;     // true when the task is considered merged/complete
  signal: MergeSignal;
  detail: string;        // human-readable, e.g. "PR #106 merged"
  hard: boolean;         // true = verified via live git/gh; false = stored state
}

/** A decision to resolve a task to `done`. */
export interface TriageDecision {
  taskId: string;
  project: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;          // always 'done' for Tier 0
  path: TaskStatus[];            // transition hops incl. endpoints (from … to)
  tier: 0;
  signal: MergeSignal;
  detail: string;
  evidenceHard: boolean;
}

export type SkipReason =
  | 'not-open'           // already done/closed/archived
  | 'no-signal'          // no merge evidence
  | 'open-pr'            // linked PR still open
  | 'claimed-active'     // claimed by a live (non-expired) session
  | 'fresh'              // soft evidence + recently touched → too risky to auto-resolve
  | 'no-path';           // no valid transition path to done

export interface TriageSkip {
  taskId: string;
  project: string;
  reason: SkipReason;
  detail: string;
}

export type TriageOutcome = TriageDecision | TriageSkip;

export function isDecision(o: TriageOutcome): o is TriageDecision {
  return (o as TriageDecision).toStatus !== undefined;
}
