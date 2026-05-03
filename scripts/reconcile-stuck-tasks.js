#!/usr/bin/env node
// Reconciles stuck in_progress tasks against merged PRs.
// For each in_progress task, checks if a merged PR exists for a matching branch, title, or body.
// If found: calls task_link_pr (verified), then task_transition → done only on success.
// Run: node scripts/reconcile-stuck-tasks.js [--dry-run] [--project COND|ACR|HBOOK]

import { execSync, execFileSync } from 'child_process';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// Safe --project extraction — never accidentally picks up another flag
const projectIdx = args.indexOf('--project');
const projectFilter = (projectIdx !== -1 && args[projectIdx + 1] && !args[projectIdx + 1].startsWith('--'))
  ? args[projectIdx + 1]
  : null;

// Optional --since flag (ISO date YYYY-MM-DD, e.g. --since 2025-01-01) to extend PR lookback
const sinceIdx = args.indexOf('--since');
const sinceRaw = (sinceIdx !== -1 && args[sinceIdx + 1] && !args[sinceIdx + 1].startsWith('--'))
  ? args[sinceIdx + 1]
  : null;
const sinceDate = (sinceRaw &&
  /^\d{4}-\d{2}-\d{2}$/.test(sinceRaw) &&
  !isNaN(new Date(sinceRaw).getTime())
) ? sinceRaw : null;
if (sinceRaw && !sinceDate) {
  console.error(`Error: --since must be a valid date in YYYY-MM-DD format, got: ${sinceRaw}`);
  process.exit(1);
}

const projects = {
  COND: 'C:/code/conductor',
  ACR: 'C:/code/acr-reimagined',
  HBOOK: 'C:/code/handbook',
};

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
  } catch {
    return null;
  }
}

// Configurable PR fetch limit. Default 200; use --limit N flag for deeper history.
const limitIdx = args.indexOf('--limit');
const prLimit = (limitIdx !== -1 && args[limitIdx + 1] && !isNaN(parseInt(args[limitIdx + 1], 10)))
  ? parseInt(args[limitIdx + 1], 10)
  : 200;

function getMergedPRs(repoDir) {
  const ghArgs = ['pr', 'list', '--state', 'merged', '--limit', String(prLimit),
    '--json', 'number,title,headRefName,body'];
  if (sinceDate) ghArgs.push('--search', `merged:>${sinceDate}`);
  try {
    const result = execFileSync('gh', ghArgs, { encoding: 'utf-8', cwd: repoDir }).trim();
    return JSON.parse(result);
  } catch { return []; }
}

function getInProgressTasks(prefix, repoDir) {
  const result = run(
    `node C:/code/mcp-agent-tasks/dist/cli.js list --status in_progress --project ${prefix} --format json`,
    { cwd: repoDir }
  );
  if (!result) return [];
  try {
    const parsed = JSON.parse(result);
    return Array.isArray(parsed) ? parsed : (parsed.tasks ?? []);
  } catch { return []; }
}

function preflight() {
  const ghCheck = run('gh auth status');
  if (ghCheck === null) { console.error('Error: gh CLI not authenticated. Run: gh auth login'); process.exit(1); }
  const cliCheck = run('node C:/code/mcp-agent-tasks/dist/cli.js --version');
  if (cliCheck === null) { console.error('Error: agent-tasks CLI not built. Run: cd C:/code/mcp-agent-tasks && npm run build'); process.exit(1); }
}

async function main() {
  preflight();
  for (const [prefix, repoDir] of Object.entries(projects)) {
    if (projectFilter && prefix !== projectFilter) continue;
    console.log(`\n=== ${prefix} (${repoDir}) ===`);

    const tasks = getInProgressTasks(prefix, repoDir);
    const prs = getMergedPRs(repoDir);

    console.log(`  ${tasks.length} in_progress tasks, ${prs.length} merged PRs`);

    for (const task of tasks) {
      const taskId = String(task.id ?? '');
      if (!/^[A-Z]+-\d+$/.test(taskId)) {
        console.log(`  SKIP: malformed task ID "${taskId}" — skipping`);
        continue;
      }

      const idUpper = taskId.toUpperCase();
      const exactMatch = prs.find(pr =>
        pr.headRefName?.toUpperCase().includes(idUpper) ||
        pr.title?.toUpperCase().includes(idUpper)
      );
      const bodyMatch = !exactMatch && prs.find(pr =>
        pr.body?.toUpperCase().includes(idUpper)
      );
      const matchedPR = exactMatch;

      const prNumber = matchedPR ? parseInt(String(matchedPR.number), 10) : NaN;

      if (matchedPR && !isNaN(prNumber)) {
        console.log(`  MATCH: ${taskId} → PR #${prNumber} (${matchedPR.headRefName})`);
        if (!dryRun) {
          console.log(`    → task_link_pr ${taskId} ${prNumber}`);
          const linkResult = run(
            `node C:/code/mcp-agent-tasks/dist/cli.js link-pr ${taskId} ${prNumber}`,
            { cwd: repoDir }
          );
          if (linkResult === null) {
            console.log(`    ✗ link-pr failed — skipping transition for ${taskId}`);
            continue;
          }
          console.log(`    → task_transition ${taskId} done`);
          const transResult = run(
            `node C:/code/mcp-agent-tasks/dist/cli.js transition ${taskId} done`,
            { cwd: repoDir }
          );
          if (transResult === null) {
            console.log(`    ✗ transition failed — ${taskId} is linked to PR but still in_progress; manual review needed`);
          }
        }
      } else if (bodyMatch) {
        console.log(`  BODY-MATCH (review manually): ${taskId} → PR #${bodyMatch.number} — task ID found only in PR body, not branch/title. Do NOT auto-transition; verify this PR completes this task.`);
      } else {
        console.log(`  NO MATCH: ${taskId} — "${String(task.title ?? '').slice(0, 50)}" (leave as-is)`);
      }
    }
  }
  console.log('\nDone.' + (dryRun ? ' (dry run — no changes made)' : ''));
}

main().catch(console.error);
