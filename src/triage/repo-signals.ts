/**
 * Tier-2 repo signals — cheap per-task signals gathered from the task's project
 * repository to give the LLM evidence for done-ness beyond task metadata alone.
 *
 * All signals use the injected CmdRunner so the module is unit-testable without
 * a real repo. Every signal is resilient: command failures return absent/zeroed
 * values, never throw.
 *
 * MCPAT-082 P4: RepoCache pre-loads `git log --oneline --all` once per repo per
 * run and matches task IDs in-memory, replacing N per-task git-log spawns with one.
 * git-grep results are also cached per keyword to avoid redundant filesystem scans.
 */
import type { Task } from '../types/task.js';
import type { CmdRunner } from './git-signals.js';

/**
 * Per-repo signal cache (MCPAT-082 P4).
 * Pre-loaded once per repo per triage run to avoid per-task git spawns.
 */
export interface RepoCache {
  /** Raw `git log --oneline --all` output, pre-warmed once per repo. */
  commitLog?: string;
  /** keyword → whether `git grep` found it in the repo. */
  grepHits: Map<string, boolean>;
}

/** Create a fresh (empty) RepoCache. */
export function createRepoCache(): RepoCache {
  return { grepHits: new Map() };
}

/**
 * Pre-warm the commit log for `repoPath` (run ONCE per repo per sweep).
 * Returns the full `git log --oneline --all` stdout, or '' on failure.
 */
export function warmCommitLog(repoPath: string, run: CmdRunner): string {
  try {
    const r = run('git', ['log', '--oneline', '--all'], repoPath);
    return r.code === 0 ? r.stdout : '';
  } catch {
    return '';
  }
}

export interface RepoSignals {
  filesTotal: number;
  filesPresent: number;
  idCommitCount: number;
  idLastDate?: string;
  filesLastTouched?: string;
  keywordsFound: string[];
  keywordsTried: string[];
}

/** Words too generic to be useful as grep keywords. */
const STOPWORDS = new Set([
  'the', 'this', 'that', 'then', 'than', 'with', 'from', 'into', 'have', 'been',
  'will', 'when', 'what', 'which', 'some', 'more', 'also', 'each', 'make', 'made',
  'does', 'done', 'need', 'needs', 'task', 'work', 'feat', 'feature', 'fix', 'fixes',
  'add', 'adds', 'update', 'updates', 'remove', 'create', 'support', 'implement',
  'file', 'files', 'type', 'types', 'data', 'info', 'list', 'item', 'items', 'using',
  'and', 'for', 'not', 'are', 'was', 'but', 'can', 'has', 'its', 'new', 'old',
  'tier', 'repo', 'signal', 'signals', 'batch', 'size', 'timeout',
]);

/**
 * Extract 1-3 salient code identifiers from a task title.
 * Pure — no I/O. Prefers quoted strings, then camelCase/PascalCase tokens,
 * then plain words; skips stopwords and tokens ≤ 3 chars.
 */
export function extractKeywords(title: string): string[] {
  const candidates: string[] = [];

  // 1. Quoted strings — highest-confidence identifiers
  title = title.replace(/"([^"]+)"|'([^']+)'/g, (_: string, d: string, s: string) => {
    const q = (d || s).trim();
    if (q.length > 3) candidates.push(q);
    return ' ';
  });

  // 2. Tokens from remaining text
  for (const token of title.split(/[\s\-_/()[\]{},.:;!?@#]+/)) {
    if (!token) continue;
    // Prefer camelCase/PascalCase identifiers (likely code symbols)
    const isCamel = /[a-z][A-Z]/.test(token) || /^[A-Z][a-zA-Z]{2,}/.test(token);
    if (isCamel && token.length > 3) {
      candidates.push(token);
    } else if (token.length > 3 && /^[a-zA-Z]/.test(token)) {
      candidates.push(token);
    }
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const c of candidates) {
    if (result.length >= 3) break;
    const lower = c.toLowerCase();
    if (seen.has(lower) || STOPWORDS.has(lower)) continue;
    seen.add(lower);
    result.push(c);
  }
  return result;
}

function emptySignals(): RepoSignals {
  return { filesTotal: 0, filesPresent: 0, idCommitCount: 0, keywordsFound: [], keywordsTried: [] };
}

const MAX_FILES = 10;

/**
 * Gather Tier-2 repo signals for `task` from `repoPath`.
 * Returns empty/zeroed signals (never throws) when repoPath is null or any
 * command fails. Uses injected CmdRunner for unit-testability.
 *
 * Pass a pre-warmed `cache` (MCPAT-082 P4) to avoid per-task git spawns:
 * - cache.commitLog: full log searched in-memory for task ID (no --grep spawn)
 * - cache.grepHits: keyword→found map to skip duplicate git-grep calls
 */
export function gatherRepoSignals(
  task: Task,
  repoPath: string | null,
  run: CmdRunner,
  cache?: RepoCache,
): RepoSignals {
  if (!repoPath) return emptySignals();

  const s = emptySignals();
  const filesToCheck = task.files.slice(0, MAX_FILES);
  s.filesTotal = filesToCheck.length;

  // Signal 1: filesExist — git ls-files reports tracked files
  for (const f of filesToCheck) {
    try {
      const r = run('git', ['ls-files', '--', f], repoPath);
      if (r.code === 0 && r.stdout.trim().length > 0) s.filesPresent++;
    } catch { /* resilient */ }
  }

  // Signal 2: taskIdInHistory — count commits mentioning the task ID
  // P4 optimisation: if commitLog is pre-warmed, search in-memory (no spawn).
  if (cache?.commitLog !== undefined) {
    const needle = task.id.toLowerCase();
    const matches = cache.commitLog
      .split('\n')
      .filter(line => line.toLowerCase().includes(needle) && line.trim().length > 0);
    s.idCommitCount = matches.length;
    if (matches.length > 0) {
      // Extract SHA from first matching line ("abc1234 commit message") for date lookup
      const sha = matches[0]?.split(' ')[0];
      if (sha) {
        try {
          const r = run('git', ['log', '-1', '--format=%cs', sha], repoPath);
          if (r.code === 0 && r.stdout.trim().length > 0) {
            s.idLastDate = r.stdout.trim();
          }
        } catch { /* resilient */ }
      }
    }
  } else {
    // Fallback: per-task git log --grep (original behaviour)
    try {
      const r = run('git', ['log', '--oneline', '--all', `--grep=${task.id}`, '-i'], repoPath);
      if (r.code === 0 && r.stdout.trim().length > 0) {
        s.idCommitCount = r.stdout.trim().split('\n').filter(Boolean).length;
        const r2 = run('git', ['log', '--all', '--format=%cs', `--grep=${task.id}`, '-1', '-i'], repoPath);
        if (r2.code === 0 && r2.stdout.trim().length > 0) {
          s.idLastDate = r2.stdout.trim();
        }
      }
    } catch { /* resilient */ }
  }

  // Signal 3: filesRecentlyTouched — most recent commit date across checked files
  if (filesToCheck.length > 0) {
    let latest: string | undefined;
    for (const f of filesToCheck) {
      try {
        const r = run('git', ['log', '-1', '--format=%cs', '--', f], repoPath);
        if (r.code === 0 && r.stdout.trim().length > 0) {
          const d = r.stdout.trim();
          if (!latest || d > latest) latest = d;
        }
      } catch { /* resilient */ }
    }
    if (latest) s.filesLastTouched = latest;
  }

  // Signal 4: keywordInCode — grep for feature symbols in the codebase
  // P4 optimisation: grepHits cache avoids duplicate git-grep calls per keyword.
  const keywords = extractKeywords(task.title);
  s.keywordsTried = keywords;
  for (const kw of keywords) {
    if (cache?.grepHits.has(kw)) {
      if (cache.grepHits.get(kw)) s.keywordsFound.push(kw);
      continue;
    }
    try {
      const r = run('git', ['grep', '-l', '--max-count=1', kw], repoPath);
      const found = r.code === 0 && r.stdout.trim().length > 0;
      if (cache) cache.grepHits.set(kw, found);
      if (found) s.keywordsFound.push(kw);
    } catch { /* resilient */ }
  }

  return s;
}

/**
 * Format repo signals as a compact string for prompt inclusion.
 * Pure. Returns '' when there is nothing useful to report.
 *
 * Example: `| files 2/2 exist; id in 3 commits (last 2026-05-30); touched 2026-05-29; "JobDispatcher" in code`
 */
export function summarizeSignals(s: RepoSignals): string {
  const parts: string[] = [];

  if (s.filesTotal > 0) {
    parts.push(`files ${s.filesPresent}/${s.filesTotal} exist`);
  }

  if (s.idCommitCount > 0) {
    const dateStr = s.idLastDate ? ` (last ${s.idLastDate})` : '';
    parts.push(`id in ${s.idCommitCount} commit${s.idCommitCount === 1 ? '' : 's'}${dateStr}`);
  }

  if (s.filesLastTouched) {
    parts.push(`touched ${s.filesLastTouched}`);
  }

  if (s.keywordsFound.length > 0) {
    const quoted = s.keywordsFound.map(k => `"${k}"`).join(', ');
    parts.push(`${quoted} in code`);
  }

  if (parts.length === 0) return '';
  return `| ${parts.join('; ')}`;
}
