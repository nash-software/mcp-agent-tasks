import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MergedPr } from './gh-client.js';

export interface LlmMatch {
  taskId: string;
  prNumber: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

interface LlmResponse {
  matches: LlmMatch[];
}

// ── Subprocess approach ───────────────────────────────────────────────────────

// On Windows + Git Bash, claude is only on the bash PATH, not cmd.exe.
// SHELL env may point to usr/bin/bash (bare POSIX shell) — normalise to
// bin/bash (the Git Bash launcher that sets up the full PATH environment).
const BASH_SHELL: string | undefined = (() => {
  const shell = process.env['SHELL'];
  if (!shell) return undefined;
  return shell.replace(/usr[/\\]bin[/\\]bash(\.exe)?$/i, 'bin\\bash.exe');
})();

function isolatedEnv(): NodeJS.ProcessEnv {
  // Minimal env: PATH + home dirs for claude auth. Strip all Claude Code session vars
  // to prevent the child process connecting back to the parent session.
  const base = process.env;
  const env: NodeJS.ProcessEnv = {
    PATH: base['PATH'],
    HOME: base['HOME'] ?? base['USERPROFILE'],
    USERPROFILE: base['USERPROFILE'],
    APPDATA: base['APPDATA'],
    LOCALAPPDATA: base['LOCALAPPDATA'],
    TEMP: base['TEMP'],
    TMP: base['TMP'],
    SystemRoot: base['SystemRoot'],
    SystemDrive: base['SystemDrive'],
    WINDIR: base['WINDIR'],
    COMPUTERNAME: base['COMPUTERNAME'],
    TERM: base['TERM'],
  };
  for (const k of Object.keys(env)) {
    if ((env as Record<string, string | undefined>)[k] === undefined) delete env[k];
  }
  return env;
}

function windowsPathToBash(p: string): string {
  return p.replace(/^([A-Za-z]):\\/, (_, d: string) => `/${d.toLowerCase()}/`).replace(/\\/g, '/');
}

// Async spawn wrapper: avoids spawnSync event-loop block.
// Uses detached: true to escape parent process group (Windows Job Objects).
function spawnAsync(cmd: string, args: string[], opts: {
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}): Promise<{ stdout: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.env,
      detached: true,
    });

    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });

    const timer = setTimeout(() => {
      child.kill();
      resolve({ stdout: '', exitCode: null });
    }, opts.timeout ?? 120_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, exitCode: code });
    });

    child.on('error', () => {
      clearTimeout(timer);
      resolve({ stdout: '', exitCode: null });
    });
  });
}

async function runClaude(prompt: string): Promise<string | null> {
  const tmpFile = path.join(os.tmpdir(), `agent-tasks-llm-${process.pid}.txt`);
  try {
    fs.writeFileSync(tmpFile, prompt, 'utf-8');

    if (BASH_SHELL) {
      const bashPath = windowsPathToBash(tmpFile);
      const { stdout, exitCode } = await spawnAsync(
        BASH_SHELL,
        ['-c', `claude < '${bashPath}'`],
        { env: isolatedEnv(), timeout: 120_000 },
      );
      if (exitCode === 0 && stdout) return stdout;
      return null;
    }

    return execFileSync('claude', ['-p', prompt], {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 120_000,
    });
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function isClaudeAvailable(): boolean {
  try {
    if (BASH_SHELL) {
      const result = spawnSync(BASH_SHELL, ['-c', 'claude --version'], {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5_000,
        env: isolatedEnv(),
      });
      return result.status === 0;
    }
    execFileSync('claude', ['--version'], { stdio: 'pipe', encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

// ── Keyword-based fallback matcher ────────────────────────────────────────────
// Used when the subprocess approach fails (e.g., inside Claude Code where
// Windows Job Objects prevent spawning independent child processes).

const STOP_WORDS = new Set([
  'plan', 'implementation', 'review', 'spec', 'handoff', 'brainstorm', 'brief',
  'the', 'and', 'or', 'for', 'with', 'to', 'a', 'an', 'in', 'of', 'on', 'at',
  'by', 'from', 'feat', 'fix', 'chore', 'refactor', 'docs', 'test', 'build',
]);

function extractFeatures(title: string): { phase: number | null; words: string[] } {
  const lower = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

  // Extract phase number
  const phaseMatch = /\bphase\s+(\d+)\b/.exec(lower);
  const phase = phaseMatch ? parseInt(phaseMatch[1], 10) : null;

  // Extract meaningful words
  const words = lower
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  return { phase, words };
}

function keywordScore(taskTitle: string, prTitle: string, prBranch: string): number {
  const task = extractFeatures(taskTitle);
  const pr = extractFeatures(`${prTitle} ${prBranch}`);

  // Phase mismatch is disqualifying
  if (task.phase !== null && pr.phase !== null && task.phase !== pr.phase) return 0;
  // Phase match is a strong signal
  const phaseBonus = task.phase !== null && pr.phase !== null && task.phase === pr.phase ? 0.3 : 0;

  if (task.words.length === 0) return 0;

  const prWordSet = new Set(pr.words);
  const matched = task.words.filter(w => prWordSet.has(w)).length;
  const overlap = matched / task.words.length;

  return Math.min(1, overlap + phaseBonus);
}

function keywordMatch(
  tasks: Array<{ id: string; title: string }>,
  prs: MergedPr[],
): LlmMatch[] {
  const results: LlmMatch[] = [];

  for (const task of tasks) {
    let bestScore = 0;
    let bestPr: MergedPr | null = null;

    for (const pr of prs) {
      const score = keywordScore(task.title, pr.title, pr.headRefName);
      if (score > bestScore) {
        bestScore = score;
        bestPr = pr;
      }
    }

    if (bestPr && bestScore >= 0.5) {
      const confidence: 'high' | 'medium' | 'low' =
        bestScore >= 0.75 ? 'high' : bestScore >= 0.5 ? 'medium' : 'low';
      results.push({
        taskId: task.id,
        prNumber: bestPr.number,
        confidence,
        reason: `keyword match (score=${bestScore.toFixed(2)}): "${bestPr.title}"`,
      });
    }
  }

  return results;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function matchTasksToPrs(
  tasks: Array<{ id: string; title: string }>,
  prs: MergedPr[],
): Promise<LlmMatch[]> {
  if (tasks.length === 0 || prs.length === 0) return [];

  // Try LLM approach first (more accurate for ambiguous cases)
  if (isClaudeAvailable()) {
    const taskList = tasks.map(t => `- ${t.id}: ${t.title}`).join('\n');
    const prList = prs.map(p => `- PR#${p.number} "${p.title}" (branch: ${p.headRefName})`).join('\n');

    const prompt = `You are matching software development tasks to their completed GitHub pull requests.

TASKS (need status resolution):
${taskList}

MERGED PULL REQUESTS:
${prList}

For each task, determine if any PR likely represents its completion. Consider:
- Semantic similarity between task title and PR title/branch
- Phase/feature naming patterns (e.g. "Phase 0 CSS Tokens" → "feat(tokens): CSS token foundation — phase 0")
- Only match when there is genuine evidence, not just superficial word overlap

Confidence levels:
- high: title/branch clearly refers to this exact task (same feature + phase/version)
- medium: likely the same work but some ambiguity
- low: possible match but uncertain

Return ONLY a JSON object with no other text:
{
  "matches": [
    {"taskId": "COND-066", "prNumber": 42, "confidence": "high", "reason": "PR title mentions CSS tokens phase 0"},
    ...
  ]
}

Only include tasks where you found a match. Omit tasks with no plausible match.`;

    const output = await runClaude(prompt);
    if (output) {
      try {
        const jsonMatch = /\{[\s\S]*\}/.exec(output.trim());
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as LlmResponse;
          if (Array.isArray(parsed.matches)) {
            const valid = parsed.matches.filter(
              m =>
                typeof m.taskId === 'string' &&
                typeof m.prNumber === 'number' &&
                ['high', 'medium', 'low'].includes(m.confidence),
            );
            if (valid.length > 0) return valid;
          }
        }
      } catch { /* fall through to keyword matching */ }
    }
  }

  // Fallback: keyword-based matching (works without subprocess)
  return keywordMatch(tasks, prs);
}
