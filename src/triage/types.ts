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

/** A decision to resolve a task to `done`. Produced by Tier 0 (git) or Tier 2 (LLM). */
export interface TriageDecision {
  taskId: string;
  project: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;          // 'done' for Tier 0/2
  path: TaskStatus[];            // transition hops incl. endpoints (from … to)
  tier: 0 | 2;
  signal: string;               // MergeSignal for Tier 0; `llm-<verdict>` for Tier 2
  detail: string;
  evidenceHard: boolean;        // Tier 0 hard git/gh evidence; false for Tier 2
  confidence?: number;          // Tier 2 model confidence (0..1)
}

export type SkipReason =
  | 'not-open'           // already done/closed/archived
  | 'no-signal'          // no merge evidence
  | 'open-pr'            // linked PR still open
  | 'claimed-active'     // claimed by a live (non-expired) session
  | 'fresh'              // soft evidence + recently touched → too risky to auto-resolve
  | 'no-path'            // no valid transition path to done
  | 'llm-keep'           // Tier 2: LLM judged still-relevant → keep
  | 'llm-unsure'         // Tier 2: LLM unsure or below confidence threshold → escalate to queue
  | 'llm-error';         // Tier 2: LLM verdict missing/unparseable for this task

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
