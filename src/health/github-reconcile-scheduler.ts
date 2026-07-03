import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HealthEvent } from './health-ledger.js';

// Post-merge only sees merges pulled locally into a working tree that ran
// the hook. A PR merged on GitHub while no local pull happens is invisible
// to it. This scheduler closes that hole with a daily, stamp-gated sweep run
// from the server's own startup (see server.ts) — stamp-gated so several
// concurrent Claude sessions each booting a server do not stampede the
// GitHub API, and the stamp is written *before* reconciling for the same
// reason.

export interface GithubReconcileSchedulerDeps {
  projects: Array<{ prefix: string; path: string }>;
  reconcile: (opts: { projectPath: string; idPrefix: string }) => Promise<{ scanned: number; reconciled: number; noSignal: number }>;
  appendEvent: (event: HealthEvent) => void;
  stampPath?: string;
  intervalMs?: number;
  now?: () => number;
}

export interface GithubReconcileSchedulerResult {
  ran: boolean;
  projects: number;
  reconciled: number;
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

function defaultStampPath(): string {
  return path.join(os.homedir(), '.claude', 'state', 'agent-tasks-github-reconcile-last-run');
}

/**
 * Sweeps every git-bearing project for GitHub-side merges the post-merge
 * hook never saw, at most once per intervalMs. Never throws — per-project
 * failures (gh unauthenticated/rate-limited/absent) are isolated into
 * ledger error events so one bad project cannot crash the server or block
 * the rest of the sweep.
 */
export async function runScheduledGithubReconcile(
  deps: GithubReconcileSchedulerDeps,
): Promise<GithubReconcileSchedulerResult> {
  try {
    const stampPath = deps.stampPath ?? defaultStampPath();
    const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
    const now = deps.now ?? Date.now;

    let last: number = NaN;
    try {
      last = Number(fs.readFileSync(stampPath, 'utf8').trim());
    } catch {
      // no stamp — due
    }
    if (Number.isFinite(last) && now() - last < intervalMs) {
      return { ran: false, projects: 0, reconciled: 0 };
    }

    // Write the stamp before reconciling so a concurrent server startup
    // racing this one does not also fire a sweep.
    fs.mkdirSync(path.dirname(stampPath), { recursive: true });
    fs.writeFileSync(stampPath, String(now()), 'utf8');

    let attempted = 0;
    let scanned = 0;
    let reconciled = 0;

    for (const entry of deps.projects) {
      if (!fs.existsSync(path.join(entry.path, '.git'))) continue;
      attempted += 1;
      try {
        const s = await deps.reconcile({ projectPath: entry.path, idPrefix: entry.prefix });
        scanned += s.scanned;
        reconciled += s.reconciled;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.appendEvent({
          source: 'daemon:mcp-agent-tasks',
          kind: 'error',
          detail: { event: 'github-reconcile', prefix: entry.prefix, message: message.slice(0, 200) },
        });
      }
    }

    deps.appendEvent({
      source: 'daemon:mcp-agent-tasks',
      kind: 'metric',
      detail: { event: 'github-reconcile', projects: attempted, scanned, reconciled },
    });

    return { ran: true, projects: attempted, reconciled };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.appendEvent({
      source: 'daemon:mcp-agent-tasks',
      kind: 'error',
      detail: { event: 'github-reconcile', message: message.slice(0, 200) },
    });
    return { ran: false, projects: 0, reconciled: 0 };
  }
}
