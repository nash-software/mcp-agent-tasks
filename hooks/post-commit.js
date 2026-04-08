#!/usr/bin/env node
// mcp-agent-tasks post-commit hook

'use strict';

const { execSync, execFileSync } = require('child_process');
const path = require('path');

function run() {
  // 1. Get current branch
  let branch;
  try {
    branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  } catch {
    process.exit(0);
  }

  // 2. Match task ID from branch name
  const idMatch = /([A-Z]+-\d+)/i.exec(branch);
  if (!idMatch) {
    process.exit(0);
  }
  const id = idMatch[1].toUpperCase();

  // 3. Get last commit info
  let sha, message;
  try {
    const log = execSync('git log -1 --format=%H %s HEAD', { encoding: 'utf-8' }).trim();
    const spaceIdx = log.indexOf(' ');
    sha = log.slice(0, spaceIdx);
    message = log.slice(spaceIdx + 1);
  } catch {
    process.exit(0);
  }

  // 4. Link commit via CLI
  const cliBin = path.join(process.cwd(), 'node_modules', '.bin', 'mcp-agent-tasks');
  try {
    execFileSync(process.execPath, [cliBin, 'link-commit', id, sha, message], {
      stdio: 'inherit',
    });
  } catch {
    // Non-fatal — don't block the commit
  }

  // 5. Optionally link PR if available
  try {
    execFileSync(process.execPath, [cliBin, 'link-pr', id], {
      stdio: 'inherit',
    });
  } catch {
    // gh CLI not available or no PR — non-fatal
  }
}

try {
  run();
} catch {
  // Always exit 0 — never block a git commit
}
process.exit(0);
