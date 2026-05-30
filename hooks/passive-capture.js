#!/usr/bin/env node
// @version 2.2.0
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

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

// ── pick best binary path from `where`/`which` output ────────────────────────
// On Windows, `where agent-tasks` returns BOTH the POSIX shell script and
// the .cmd wrapper. Passing the bare shell script to node.exe crashes with
// SyntaxError. Prefer .cmd on win32; fall back to first non-empty line.
function pickBestBinary(lines, platform) {
  const nonEmpty = lines.filter(line => typeof line === 'string' && line.trim() !== '');
  if (nonEmpty.length === 0) return null;
  if (platform === 'win32') {
    const cmd = nonEmpty.find(line => line.toLowerCase().endsWith('.cmd'));
    if (cmd) return cmd;
  }
  return nonEmpty[0];
}

// ── locate global config (~/.config/mcp-tasks/config.json) ──────────────────
// Respects MCP_TASKS_CONFIG env-var override for testing and per-machine config.
function findGlobalConfig() {
  const override = process.env.MCP_TASKS_CONFIG;
  const configPath = override || path.join(os.homedir(), '.config', 'mcp-tasks', 'config.json');
  return fs.existsSync(configPath) ? configPath : null;
}

// ── humanize file path to a title ────────────────────────────────────────────
function humanizeTitle(fp, type) {
  const base = path.basename(fp, path.extname(fp));
  const clean = base.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  return `${type.charAt(0).toUpperCase() + type.slice(1)}: ${clean}`;
}

// ── resolve project prefix from config ───────────────────────────────────────
function resolvePrefix(mcpConfig) {
  const projects = Array.isArray(mcpConfig.projects) ? mcpConfig.projects : [];
  if (projects.length > 0 && projects[0].prefix) return projects[0].prefix;
  return null;
}

// ── resolve CLI binary ────────────────────────────────────────────────────────
function resolveBinary(configPath) {
  try {
    const stdout = execSync('where agent-tasks 2>NUL || which agent-tasks 2>/dev/null', {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const best = pickBestBinary(stdout.trim().split(/\r?\n/), process.platform);
    if (best) return best;
  } catch { /* not in PATH */ }
  return path.join(path.dirname(configPath), 'node_modules', '.bin', 'agent-tasks');
}

module.exports = {
  classifyPath,
  pickBestBinary,
  findGlobalConfig,
  humanizeTitle,
  resolvePrefix,
  resolveBinary,
};

// ── script entry point ────────────────────────────────────────────────────────
// Side effects only run when this file is invoked directly (not require()-d).
if (require.main === module) {
  if (process.env.MCP_TASKS_DRY_RUN === '1') {
    process.stderr.write('[passive-capture] DRY_RUN mode — exiting\n');
    process.exit(0);
  }

  let hookData = {};
  try {
    const raw = fs.readFileSync(0, 'utf-8');
    hookData = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const toolInput = (hookData && hookData.tool_input) || {};
  const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : null;

  if (!filePath) process.exit(0);

  const fileType = classifyPath(filePath);
  if (fileType === 'skip') process.exit(0);

  const configPath = findGlobalConfig();
  if (!configPath) process.exit(0);

  let mcpConfig = {};
  try {
    mcpConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    process.exit(0);
  }

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

  const configDir = path.dirname(configPath);
  const sessionFile = path.join(configDir, '.mcp-tasks-session.json');

  let sessionState = {};
  try {
    sessionState = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
  } catch {
    sessionState = {};
  }

  const activeTask = taskIdFromBranch || (sessionState && sessionState.active_task) || null;

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

  let createdTaskId = null;

  try {
    if ((fileType === 'plan' || fileType === 'spec' || fileType === 'spike') && !activeTask) {
      const prefix = resolvePrefix(mcpConfig);
      if (!prefix) process.exit(0);

      const title = humanizeTitle(filePath, fileType);
      const why = `Auto-captured from file write: ${filePath}`;
      const binary = resolveBinary(configPath);

      const result = spawnSync(
        process.execPath,
        [
          binary,
          'create',
          '--project', prefix,
          '--title', title,
          '--type', fileType,
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
        createdTaskId = createdId;
        try {
          writeSessionState({ active_task: createdId, updated_at: new Date().toISOString() });
        } catch { /* non-fatal */ }
        process.stderr.write(`[passive-capture] Created ${createdId} (${fileType}) for ${filePath}\n`);
      }

    } else if (fileType === 'code_change' && activeTask) {
      const result = spawnSync(
        process.execPath,
        [
          resolveBinary(configPath),
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
  }

  // ── artifact log append ───────────────────────────────────────────────────
  // Append a JSONL record to ~/.mcp-tasks/artifacts.jsonl after all task logic.
  // Failure here is non-fatal — never break the hook.
  try {
    const mcpTasksDir = path.join(os.homedir(), '.mcp-tasks');
    const artifactsPath = path.join(mcpTasksDir, 'artifacts.jsonl');
    // Resolve project prefix from config; fall back to GEN
    const resolvedPrefix = resolvePrefix(mcpConfig) || 'GEN';
    const record = JSON.stringify({
      path: filePath,
      project: resolvedPrefix,
      created_at: new Date().toISOString(),
      task_id: createdTaskId || activeTask || null,
    });
    try {
      fs.mkdirSync(mcpTasksDir, { recursive: true });
    } catch { /* ignore if already exists */ }
    // Compact artifacts.jsonl on write (MCPAT-049 F3): apply the same semantics
    // the read path uses — dedupe by path (keep newest) and drop records older
    // than the 30-day TTL — then persist only that reduced set, hard-capped at
    // ARTIFACTS_MAX. This bounds size AND keeps the file canonical.
    const ARTIFACTS_MAX = 5000;
    const TTL_MS = 30 * 24 * 60 * 60 * 1000;
    try {
      let records = [];
      if (fs.existsSync(artifactsPath)) {
        for (const l of fs.readFileSync(artifactsPath, 'utf-8').split('\n')) {
          if (!l.trim()) continue;
          try { records.push(JSON.parse(l)); } catch { /* skip malformed */ }
        }
      }
      records.push(JSON.parse(record));
      // Dedupe by path, keeping the last (newest) occurrence.
      const byPath = new Map();
      for (const r of records) byPath.set(r && r.path, r);
      const now = Date.now();
      let kept = [...byPath.values()].filter(r => {
        const t = r && r.created_at ? Date.parse(r.created_at) : NaN;
        return Number.isNaN(t) || (now - t) <= TTL_MS; // keep undated + within TTL
      });
      if (kept.length > ARTIFACTS_MAX) kept = kept.slice(-ARTIFACTS_MAX);
      const tmp = artifactsPath + '.tmp.' + process.pid;
      fs.writeFileSync(tmp, kept.map(r => JSON.stringify(r)).join('\n') + '\n');
      fs.renameSync(tmp, artifactsPath);
    } catch {
      fs.appendFileSync(artifactsPath, record + '\n'); // fallback: plain append
    }
  } catch (e) {
    process.stderr.write('[passive-capture] artifact log write failed: ' + (e && e.message ? e.message : String(e)) + '\n');
  }

  process.exit(0);
}
