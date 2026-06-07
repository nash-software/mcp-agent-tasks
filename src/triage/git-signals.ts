/**
 * Tier-0 merge probe. Determines whether a task is provably merged by querying
 * live git/gh in the task's project repo, falling back to the PR state stored on
 * the task when the repo is unavailable (decision D3).
 *
 * The command runner is injected so the logic is unit-testable without spawning.
 */
import { spawnSync } from 'node:child_process';
import type { Task } from '../types/task.js';
import type { MergeEvidence, MergeSignal } from './types.js';

export interface CmdResult { code: number; stdout: string }
export type CmdRunner = (cmd: string, args: string[], cwd?: string) => CmdResult;

/** Default runner: spawnSync, shell:false (Windows-safe), stderr ignored. */
export const defaultRunner: CmdRunner = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, shell: false, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  return { code: r.status ?? 1, stdout: r.stdout ?? '' };
};

function evidence(resolved: boolean, signal: MergeSignal, detail: string, hard: boolean): MergeEvidence {
  return { resolved, signal, detail, hard };
}

function branchListed(stdout: string, branch: string): boolean {
  return stdout.split('\n').map(l => l.replace(/^[*+]?\s*/, '').trim()).includes(branch);
}

/**
 * Probe whether `task` is merged. `repoPath` is the task's project repo root (or null).
 * Live signals are hard evidence; the stored PR state is a soft fallback.
 */
export function probeMerge(task: Task, repoPath: string | null, run: CmdRunner = defaultRunner): MergeEvidence {
  const pr = task.git.pr;
  const base = pr?.base_branch || 'main';
  const ref = `origin/${base}`;

  if (repoPath) {
    // 1. Linked PR via gh (authoritative).
    if (pr?.number) {
      const r = run('gh', ['pr', 'view', String(pr.number), '--json', 'state,mergedAt'], repoPath);
      if (r.code === 0) {
        try {
          const j = JSON.parse(r.stdout) as { state?: string; mergedAt?: string | null };
          if (j.state === 'MERGED' || (j.mergedAt != null && j.mergedAt !== '')) {
            return evidence(true, 'pr-merged', `PR #${pr.number} merged`, true);
          }
          if (j.state === 'OPEN') return evidence(false, 'open-pr', `PR #${pr.number} open`, true);
          // CLOSED-not-merged → fall through to commit/branch checks.
        } catch { /* unparseable → fall through */ }
      }
    }
    // 2. A linked commit is an ancestor of the base branch.
    for (const c of task.git.commits) {
      const r = run('git', ['merge-base', '--is-ancestor', c.sha, ref], repoPath);
      if (r.code === 0) return evidence(true, 'commit-in-main', `commit ${c.sha.slice(0, 7)} in ${ref}`, true);
    }
    // 3. The linked branch is merged into the base branch.
    if (task.git.branch) {
      const r = run('git', ['branch', '--merged', ref], repoPath);
      if (r.code === 0 && branchListed(r.stdout, task.git.branch)) {
        return evidence(true, 'branch-merged', `branch ${task.git.branch} merged into ${ref}`, true);
      }
    }
  }

  // 4. Fallback to the PR state stored on the task (soft).
  if (pr?.state === 'merged') return evidence(true, 'pr-state-fallback', `stored PR #${pr.number} state=merged`, false);
  if (pr?.state === 'open') return evidence(false, 'open-pr', `PR #${pr.number} open`, false);
  return evidence(false, 'none', 'no merge evidence', false);
}
