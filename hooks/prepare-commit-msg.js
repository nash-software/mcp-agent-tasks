#!/usr/bin/env node
// agent-tasks prepare-commit-msg hook

'use strict';

const fs = require('fs');
const { execSync } = require('child_process');

function run() {
  const msgFile = process.argv[2];
  const source = process.argv[3];

  // Skip merge, squash, and fixup commits
  if (source === 'merge' || source === 'squash' || source === 'commit') {
    process.exit(0);
  }

  // Get current branch and extract task ID
  let branch;
  try {
    branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  } catch {
    process.exit(0);
  }

  const idMatch = /([A-Z]+-\d+)/i.exec(branch);
  if (!idMatch) {
    process.exit(0);
  }
  const id = idMatch[1].toUpperCase();

  // Read existing commit message
  if (!msgFile || !fs.existsSync(msgFile)) {
    process.exit(0);
  }

  const msg = fs.readFileSync(msgFile, 'utf-8');
  const lines = msg.split('\n');
  const firstLine = lines[0] ?? '';

  // Don't prefix if already prefixed
  if (firstLine.startsWith(`[${id}]`)) {
    process.exit(0);
  }

  // Prepend task ID to first line
  lines[0] = `[${id}] ${firstLine}`;
  fs.writeFileSync(msgFile, lines.join('\n'), 'utf-8');
}

try {
  run();
} catch {
  // Never block a commit
}
process.exit(0);
