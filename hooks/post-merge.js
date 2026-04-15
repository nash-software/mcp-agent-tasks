#!/usr/bin/env node
// agent-tasks post-merge hook
// Fires after `git pull` / `git merge`. Extracts task IDs from the merged PR
// and auto-transitions them to done.

'use strict';

const { execSync } = require('child_process');
const { existsSync, readdirSync } = require('fs');
const path = require('path');

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
    }
  }

  if (closed.length > 0) {
    console.log(`[agent-tasks] Closed ${closed.length} task(s): ${closed.join(', ')}`);
  }
}

try {
  main();
} catch {
  // Always exit 0 — never block a git operation
}
process.exit(0);
