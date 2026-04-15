#!/usr/bin/env node
// mcp-agent-tasks task-gate PreToolUse hook
// Zero non-built-in require() calls — only fs, path, os, child_process

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── bypass ────────────────────────────────────────────────────────────────────

if (process.env.SKIP_TASK_GATE === '1') {
  process.exit(0);
}

// ── read stdin for tool_input ──────────────────────────────────────────────────
let toolInput = {};
try {
  const raw = fs.readFileSync(0, 'utf-8');
  const parsed = JSON.parse(raw);
  toolInput = parsed.tool_input || {};
} catch (_) {
  // malformed or no stdin — continue with empty toolInput
}

const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : null;

// ── scratchpads always allowed ────────────────────────────────────────────────
if (filePath && /scratchpads[/\\]/.test(filePath)) {
  process.exit(0);
}

// ── only gate on code-like files ─────────────────────────────────────────────
// Non-code files (markdown, yaml, json, html, etc.) are always allowed
const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|sql)$/;
if (filePath && !CODE_EXTENSIONS.test(filePath)) {
  process.exit(0);
}

// ── session dedup ─────────────────────────────────────────────────────────────
// Only warn once per parent process session

const ppid = process.ppid || 0;
const flagFile = path.join(os.tmpdir(), `mcp-tasks-warned-${ppid}`);
const alreadyWarned = fs.existsSync(flagFile);

// ── locate index.yaml ─────────────────────────────────────────────────────────

function findIndexYaml() {
  // 1. MCP_TASKS_PROJECT + MCP_TASKS_DIR
  const tasksDir = process.env.MCP_TASKS_DIR;
  if (tasksDir) {
    const candidate = path.join(tasksDir, 'index.yaml');
    if (fs.existsSync(candidate)) return candidate;
  }

  // 2. Walk cwd ancestors for .mcp-tasks.json
  let dir = process.cwd();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const config = path.join(dir, '.mcp-tasks.json');
    if (fs.existsSync(config)) {
      try {
        const raw = JSON.parse(fs.readFileSync(config, 'utf-8'));
        const projects = Array.isArray(raw.projects) ? raw.projects : [];
        // Check each project path
        for (const proj of projects) {
          if (proj.path) {
            const candidate = path.join(proj.path, 'tasks', 'index.yaml');
            if (fs.existsSync(candidate)) return candidate;
          }
        }
        // Fallback: tasks/ in same dir as config
        const candidate = path.join(dir, 'tasks', 'index.yaml');
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        // malformed config — skip
      }
    }

    // Also check for tasks/index.yaml directly
    const directCandidate = path.join(dir, 'tasks', 'index.yaml');
    if (fs.existsSync(directCandidate)) return directCandidate;

    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  return null;
}

// ── simple YAML parser for index.yaml ────────────────────────────────────────
// We only need to detect `status: in_progress` lines — no full YAML required.

function findInProgressTask(indexYamlPath) {
  const content = fs.readFileSync(indexYamlPath, 'utf-8');
  const lines = content.split('\n');

  let currentId = null;

  for (const line of lines) {
    // Match task ID lines like `- id: PROJ-001`
    const idMatch = /^\s*[-\s]*id:\s*([A-Z]+-\d+)/i.exec(line);
    if (idMatch) {
      currentId = idMatch[1];
    }

    // Match status line
    const statusMatch = /^\s*status:\s*(\S+)/.exec(line);
    if (statusMatch && statusMatch[1] === 'in_progress' && currentId) {
      return currentId;
    }
  }

  return null;
}

// ── main ──────────────────────────────────────────────────────────────────────

const indexYaml = findIndexYaml();
if (!indexYaml) {
  // No tasks project found — silently allow (no task tracking configured)
  process.exit(0);
}

let inProgressId;
try {
  inProgressId = findInProgressTask(indexYaml);
} catch {
  // Unreadable — silently allow
  process.exit(0);
}

if (inProgressId) {
  // There is an in_progress task — editing code files is expected, allow
  process.exit(0);
}

// No in_progress task found — warn/block code file edits
if (!alreadyWarned) {
  try {
    fs.writeFileSync(flagFile, String(Date.now()), 'utf-8');
  } catch {
    // tmpdir write failure — non-fatal
  }
}

process.stdout.write(
  JSON.stringify({
    type: 'error',
    message: '\u26a0 Task gate: no in_progress task found. Start a task before editing code files.\nSet SKIP_TASK_GATE=1 to bypass.',
  }) + '\n',
);
process.exit(2);
