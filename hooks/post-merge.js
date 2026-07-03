#!/usr/bin/env node
// agent-tasks post-merge hook
// Fires after `git pull` / `git merge`. Extracts task IDs from the merged PR
// and auto-transitions them to done.

'use strict';

const { execSync, spawn } = require('child_process');
const { existsSync, readdirSync, mkdirSync, appendFileSync } = require('fs');
const os = require('os');
const path = require('path');

// Append a structured failure record to the nervous-system ledger so a silent
// post-merge close failure becomes something the health pulse can watch.
// Dependency-free and non-fatal — must never throw or break the git hook.
// Also mirrors the record into health.jsonl (kind: 'error') — the legacy
// agent-tasks-failures.jsonl file has no reader; health-pulse.js only
// watches health.jsonl, so that's where the pulse's error-volume alarm and
// /factory-health actually look.
function escalate(project, taskId, error) {
  try {
    const stateDir = path.join(os.homedir(), '.claude', 'state');
    mkdirSync(stateDir, { recursive: true });
    const record = { ts: new Date().toISOString(), project, taskId, error: String(error || 'unknown') };
    appendFileSync(path.join(stateDir, 'agent-tasks-failures.jsonl'), JSON.stringify(record) + '\n');
    const healthRecord = {
      ts: new Date().toISOString(),
      source: 'hook:agent-tasks-post-merge',
      kind: 'error',
      detail: { project, taskId, error: String(error || 'unknown') },
      session: null,
    };
    appendFileSync(path.join(stateDir, 'health.jsonl'), JSON.stringify(healthRecord) + '\n');
  } catch {
    // Never let escalation break the hook.
  }
}

function run(cmd, opts) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
  } catch {
    return null;
  }
}

function extractPrNumber(commitMsg) {
  const match = commitMsg.match(/#(\d+)/);
  return match ? match[1] : null;
}

function extractTaskIds(text, knownPrefixes) {
  const pattern = /\b([A-Z]+-\d+)\b/g;
  const ids = new Set();
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const prefix = m[1].split('-')[0];
    if (knownPrefixes.has(prefix)) ids.add(m[1]);
  }
  return [...ids];
}

function discoverPrefixes(repoRoot) {
  const prefixes = new Set();
  const agentTasksDir = path.resolve(repoRoot, 'agent-tasks');
  if (!existsSync(agentTasksDir)) return prefixes;
  try {
    for (const file of readdirSync(agentTasksDir)) {
      const m = file.match(/^([A-Z]+)-\d+\.md$/);
      if (m) prefixes.add(m[1]);
    }
  } catch {
    // ignore read errors
  }
  return prefixes;
}

function main() {
  const repoRoot = run('git rev-parse --show-toplevel');
  if (!repoRoot) return;

  const headMsg = run('git log -1 --format=%s%n%b HEAD');
  if (!headMsg) return;

  const prNumber = extractPrNumber(headMsg);
  if (!prNumber) return; // Not a PR merge commit

  // Check gh is available
  const gh = run('which gh') || run('where gh');
  if (!gh) {
    console.warn('[agent-tasks] post-merge: gh CLI not found, skipping auto-transition');
    return;
  }

  const prJson = run(`gh pr view ${prNumber} --json number,url,state,title,body,mergedAt,headRefName`);
  if (!prJson) return;

  let pr;
  try { pr = JSON.parse(prJson); } catch { return; }

  // gh GraphQL returns 'MERGED'; REST may return 'merged' — normalise
  if ((pr.state || '').toLowerCase() !== 'merged') return;

  const prefixes = discoverPrefixes(repoRoot);
  if (prefixes.size === 0) return;

  const searchText = [pr.title, pr.body, pr.headRefName].filter(Boolean).join('\n');
  const taskIds = extractTaskIds(searchText, prefixes);
  if (taskIds.length === 0) return;

  // Prefer local node_modules bin; fall back to global
  const localBin = path.resolve(repoRoot, 'node_modules', '.bin', 'agent-tasks');
  const bin = existsSync(localBin) ? localBin : 'agent-tasks';

  const closed = [];
  for (const id of taskIds) {
    const mergedAtArg = pr.mergedAt ? `--merged-at "${pr.mergedAt}"` : '';
    const result = run(
      `"${bin}" link-pr ${id} --pr-number ${pr.number} --pr-url "${pr.url}" --pr-state merged ${mergedAtArg}`,
      { cwd: repoRoot }
    );
    if (result !== null) {
      closed.push(id);
    } else {
      console.warn(`[agent-tasks] post-merge: failed to close ${id}`);
      escalate(repoRoot, id, `link-pr returned no output for PR #${pr.number}`);
    }
  }

  if (closed.length > 0) {
    console.log(`[agent-tasks] Closed ${closed.length} task(s): ${closed.join(', ')}`);
  }

  // Fallback: any task the loop above could not close still has its GitHub
  // evidence (this merged PR) available — hand it to reconcile-github as an
  // automatic second chance instead of leaving it stuck forever. Detached +
  // process.execPath (never the .cmd shim) so `git pull` is never blocked by
  // GitHub API latency and no console window flashes on Windows.
  const failedIds = taskIds.filter((id) => !closed.includes(id));
  if (failedIds.length > 0) {
    const candidates = [
      path.join(repoRoot, 'dist', 'cli.js'),
      path.join(repoRoot, 'node_modules', 'mcp-agent-tasks', 'dist', 'cli.js'),
    ];
    const cliPath = candidates.find((p) => existsSync(p));
    if (!cliPath) {
      console.warn('[agent-tasks] post-merge: cli not found, skipping reconcile fallback');
    } else {
      const failedPrefixes = [...new Set(failedIds.map((id) => id.split('-')[0]))];
      for (const prefix of failedPrefixes) {
        spawn(process.execPath, [cliPath, 'reconcile-github', '--project', repoRoot, '--prefix', prefix], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          cwd: repoRoot,
        }).unref();
      }
      console.log(`[agent-tasks] post-merge: handed off to reconcile-github for prefix(es): ${failedPrefixes.join(', ')}`);
    }
  }
}

try {
  main();
} catch {
  // Always exit 0 — never block a git operation
}
process.exit(0);
