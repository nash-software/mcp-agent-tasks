#!/usr/bin/env node
// @version 2.0.0
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

// ── dry-run short-circuit ──────────────────────────────────────────────────────
if (process.env.MCP_TASKS_DRY_RUN === '1') {
  process.stderr.write('[passive-capture] DRY_RUN mode — exiting\n');
  process.exit(0);
}

// ── read stdin ─────────────────────────────────────────────────────────────────
let hookData = {};
try {
  const raw = fs.readFileSync(0, 'utf-8');
  hookData = JSON.parse(raw);
} catch {
  // malformed or no stdin — always safe to exit 0
  process.exit(0);
}

const toolInput = (hookData && hookData.tool_input) || {};
const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : null;

if (!filePath) {
  process.exit(0);
}

// ── classify file path ────────────────────────────────────────────────────────
function classifyPath(fp) {
  const normalized = fp.replace(/\\/g, '/');
  if (/\/agent-tasks\//.test(normalized)) return 'skip';
  if (/\/scratchpads\/[^/]+-plan\.md$/.test(normalized)) return 'plan';
  if (/\/scratchpads\/[^/]+-spec\.md$/.test(normalized)) return 'spec';
  if (/\/scratchpads\/[^/]+-spike\.md$/.test(normalized)) return 'spike';
  if (/\.(ts|js|tsx|jsx|py|go|rs|java|c|cpp|h|sql)$/.test(normalized)) return 'code_change';
  return 'skip';
}

const fileType = classifyPath(filePath);
if (fileType === 'skip') {
  process.exit(0);
}

// ── locate .mcp-tasks.json ────────────────────────────────────────────────────
function findMcpTasksConfig() {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, '.mcp-tasks.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const configPath = findMcpTasksConfig();
if (!configPath) {
  process.exit(0);
}

let mcpConfig = {};
try {
  mcpConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch {
  process.exit(0);
}

// ── get git branch + infer task ID ───────────────────────────────────────────
let branch = null;
try {
  branch = execSync('git branch --show-current', {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim() || null;
} catch {
  branch = null;
}

let taskIdFromBranch = null;
if (branch) {
  const m = /([A-Z]+-\d+)/.exec(branch);
  if (m) taskIdFromBranch = m[1];
}

// ── read session state ────────────────────────────────────────────────────────
const configDir = path.dirname(configPath);
const sessionFile = path.join(configDir, '.mcp-tasks-session.json');

let sessionState = {};
try {
  sessionState = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
} catch {
  sessionState = {};
}

const activeTask = taskIdFromBranch || (sessionState && sessionState.active_task) || null;

// ── resolve project prefix from config ───────────────────────────────────────
function resolvePrefix() {
  const projects = Array.isArray(mcpConfig.projects) ? mcpConfig.projects : [];
  if (projects.length > 0 && projects[0].prefix) return projects[0].prefix;
  return null;
}

// ── humanize file path to a title ────────────────────────────────────────────
function humanizeTitle(fp, type) {
  const base = path.basename(fp, path.extname(fp));
  const clean = base.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  return `${type.charAt(0).toUpperCase() + type.slice(1)}: ${clean}`;
}

// ── write session state atomically ───────────────────────────────────────────
function writeSessionState(state) {
  const tmp = sessionFile + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, sessionFile);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

// ── resolve CLI binary ────────────────────────────────────────────────────────
// Prefer PATH (global install), fall back to local node_modules/.bin
function resolveBinary() {
  try {
    const which = execSync('where agent-tasks 2>NUL || which agent-tasks 2>/dev/null', {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split(/\r?\n/)[0];
    if (which) return which;
  } catch { /* not in PATH */ }
  return path.join(path.dirname(configPath), 'node_modules', '.bin', 'agent-tasks');
}

// ── main logic ────────────────────────────────────────────────────────────────
try {
  if ((fileType === 'plan' || fileType === 'spec' || fileType === 'spike') && !activeTask) {
    // Auto-capture: create a new task
    const prefix = resolvePrefix();
    if (!prefix) {
      process.exit(0);
    }

    const title = humanizeTitle(filePath, fileType);
    const why = `Auto-captured from file write: ${filePath}`;
    const binary = resolveBinary();

    const result = spawnSync(
      process.execPath,
      [
        binary,
        'create',
        '--project', prefix,
        '--title', title,
        '--type', fileType,   // plan → plan, spec → spec, spike → spike (correct mapping)
        '--priority', 'medium',
        '--why', why,
        '--auto-captured',
        '--plan-file', filePath,
      ],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const stdout = (result.stdout || '').trim();
    const createdId = stdout.match(/^([A-Z]+-\d+)/) ? stdout.match(/^([A-Z]+-\d+)/)[1] : null;

    if (createdId) {
      try {
        writeSessionState({ active_task: createdId, updated_at: new Date().toISOString() });
      } catch { /* non-fatal */ }
      process.stderr.write(`[passive-capture] Created ${createdId} (${fileType}) for ${filePath}\n`);
    }

  } else if (fileType === 'code_change' && activeTask) {
    // Link file to active task
    const result = spawnSync(
      process.execPath,
      [
        resolveBinary(),
        'add-file',
        activeTask,
        filePath,
      ],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    if (result.status === 0) {
      process.stderr.write(`[passive-capture] Linked ${filePath} → ${activeTask}\n`);
    }
  }
} catch (e) {
  process.stderr.write(`[passive-capture] ERROR: ${e && e.message ? e.message : String(e)}\n`);
  // always exit 0 — hook must never block the tool
}

process.exit(0);
