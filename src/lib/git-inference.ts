import { execSync, execFileSync } from 'node:child_process';

export interface GitInferenceResult {
  branch: string | undefined;
  merged: boolean;
  mergeCommitSha: string | undefined;
  mergeCommitMessage: string | undefined;
  prNumber: number | undefined;
  firstCommitDate: string | undefined;  // ISO-8601
  lastCommitDate: string | undefined;   // ISO-8601
}

export interface GitInferenceOptions {
  projectPath: string;
  slug: string;
  filePath: string; // absolute path to the scratchpad file
}

export function isGitRepo(projectPath: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

export function listBranches(projectPath: string): string[] {
  try {
    const output = execSync(
      'git for-each-ref --format=%(refname:short) refs/heads refs/remotes',
      { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' },
    );
    const seen = new Set<string>();
    const result: string[] = [];
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        result.push(trimmed);
      }
    }
    return result;
  } catch {
    return [];
  }
}

export function findMatchingBranch(
  slug: string,
  branches: string[],
): string | undefined {
  // 1. Exact match
  if (branches.includes(slug)) return slug;

  // 2. Prefix variants
  const prefixes = ['feature/', 'feat/', 'fix/', 'origin/feature/', 'origin/feat/', 'origin/fix/'];
  for (const prefix of prefixes) {
    const candidate = `${prefix}${slug}`;
    if (branches.includes(candidate)) return candidate;
  }

  // 3. LCS fallback — accept if LCS >= 60% of slug length
  const threshold = Math.ceil(slug.length * 0.6);
  let bestBranch: string | undefined;
  let bestLcs = 0;

  for (const branch of branches) {
    const lcs = longestCommonSubstring(slug, branch);
    if (lcs > bestLcs) {
      bestLcs = lcs;
      bestBranch = branch;
    }
  }

  if (bestLcs >= threshold) return bestBranch;
  return undefined;
}

function longestCommonSubstring(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  // O(m*n) DP: dp[i][j] = length of common substring ending at a[i-1], b[j-1]
  const m = a.length;
  const n = b.length;
  // Use two rows to save memory
  let prev = new Array<number>(n + 1).fill(0);
  let maxLen = 0;
  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = (prev[j - 1] ?? 0) + 1;
        if (curr[j]! > maxLen) maxLen = curr[j]!;
      }
    }
    prev = curr;
  }
  return maxLen;
}

export function findMergeCommit(
  projectPath: string,
  branch: string,
): { sha: string; message: string } | undefined {
  // branch is safe (comes from git itself), but we still use shell-safe approach
  try {
    const output = execSync(
      `git log --all --merges --grep=${branch} --format=%H|%s -n 1`,
      { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' },
    );
    const line = output.trim().split('\n')[0]?.trim();
    if (!line) return undefined;
    const pipeIndex = line.indexOf('|');
    if (pipeIndex === -1) return undefined;
    const sha = line.slice(0, pipeIndex).trim();
    const message = line.slice(pipeIndex + 1).trim();
    if (!sha) return undefined;
    return { sha, message };
  } catch {
    return undefined;
  }
}

export function findMergeCommitBySlug(
  projectPath: string,
  slug: string,
): { sha: string; message: string } | undefined {
  // slug is [a-z0-9-] only — safe in shell, but still use cwd pattern
  try {
    const output = execSync(
      `git log --all --merges --grep=${slug} --format=%H|%s -n 1`,
      { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' },
    );
    const line = output.trim().split('\n')[0]?.trim();
    if (!line) return undefined;
    const pipeIndex = line.indexOf('|');
    if (pipeIndex === -1) return undefined;
    const sha = line.slice(0, pipeIndex).trim();
    const message = line.slice(pipeIndex + 1).trim();
    if (!sha) return undefined;
    return { sha, message };
  } catch {
    return undefined;
  }
}

export function extractPrNumber(mergeMessage: string): number | undefined {
  const match = /\(#(\d+)\)/.exec(mergeMessage);
  if (!match) return undefined;
  const num = Number(match[1]);
  return isNaN(num) ? undefined : num;
}

export function getFileFirstCommitDate(
  projectPath: string,
  filePath: string,
): string | undefined {
  try {
    // Use execFileSync with argv array to avoid shell interpolation of filePath
    const output = execFileSync(
      'git',
      ['log', '--follow', '--diff-filter=A', '--format=%aI', '--', filePath],
      { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' },
    );
    const lines = output.trim().split('\n').filter(l => l.trim());
    // First commit is the last line in reverse-chronological output (oldest)
    const date = lines[lines.length - 1]?.trim();
    return date || undefined;
  } catch {
    return undefined;
  }
}

export function getFileLastCommitDate(
  projectPath: string,
  filePath: string,
): string | undefined {
  try {
    // Use execFileSync with argv array to avoid shell interpolation of filePath
    const output = execFileSync(
      'git',
      ['log', '--follow', '--format=%aI', '-n', '1', '--', filePath],
      { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' },
    );
    const date = output.trim().split('\n')[0]?.trim();
    return date || undefined;
  } catch {
    return undefined;
  }
}

export function inferGitContext(
  options: GitInferenceOptions,
): GitInferenceResult {
  const empty: GitInferenceResult = {
    branch: undefined,
    merged: false,
    mergeCommitSha: undefined,
    mergeCommitMessage: undefined,
    prNumber: undefined,
    firstCommitDate: undefined,
    lastCommitDate: undefined,
  };

  if (!isGitRepo(options.projectPath)) {
    return empty;
  }

  const { projectPath, slug, filePath } = options;

  const branches = listBranches(projectPath);
  const branch = findMatchingBranch(slug, branches);

  const firstCommitDate = getFileFirstCommitDate(projectPath, filePath);
  const lastCommitDate = getFileLastCommitDate(projectPath, filePath);

  // Try to find a merge commit
  let mergeResult: { sha: string; message: string } | undefined;
  let merged = false;

  if (branch !== undefined) {
    mergeResult = findMergeCommit(projectPath, branch);
  }

  if (!mergeResult) {
    // Fallback: search by slug across all merge commits
    mergeResult = findMergeCommitBySlug(projectPath, slug);
  }

  if (mergeResult) {
    merged = true;
  }

  const prNumber =
    mergeResult !== undefined ? extractPrNumber(mergeResult.message) : undefined;

  return {
    branch,
    merged,
    mergeCommitSha: mergeResult?.sha,
    mergeCommitMessage: mergeResult?.message,
    prNumber,
    firstCommitDate,
    lastCommitDate,
  };
}
