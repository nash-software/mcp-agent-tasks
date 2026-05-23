'use strict';

// hooks/lib/project-router.js
// Routes intents to registered projects by CWD match, prefix hint, or GEN global fallback.
// Zero npm imports — builtins only.
// No side-effects when require()-d; exports: { routeProject, normalizePath, readConfig }.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

// ── pickBestBinary ─────────────────────────────────────────────────────────────
// Copied verbatim from hooks/passive-capture.js (authoritative source).
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

// ── resolveBinary ──────────────────────────────────────────────────────────────
// Resolves a binary by name using where/which, then falls back to trusted roots.
// Only accepts paths within: os.homedir(), global npm prefix, path.dirname(process.execPath).
// Rejects /tmp, os.tmpdir(), and world-writable directories.
function resolveBinary(name) {
  // Try where/which first
  try {
    const stdout = execSync(
      process.platform === 'win32'
        ? `where ${name} 2>NUL`
        : `which ${name} 2>/dev/null`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const best = pickBestBinary(stdout.trim().split(/\r?\n/), process.platform);
    if (best && isTrustedPath(best)) return best;
  } catch { /* not in PATH */ }

  // Trusted-roots fallback: look for binary in known safe locations
  const trustedRoots = [
    os.homedir(),
    getGlobalNpmPrefix(),
    path.dirname(process.execPath),
  ].filter(Boolean);

  for (const root of trustedRoots) {
    const candidate = path.join(root, 'node_modules', '.bin', name);
    if (isTrustedPath(candidate)) return candidate;
  }

  // Final fallback: dist/cli.js relative to this file's location (hooks/lib → project root)
  const projectRoot = path.resolve(__dirname, '..', '..');
  const distCli = path.join(projectRoot, 'dist', 'cli.js');
  if (isTrustedPath(distCli)) return distCli;

  return null; // No trusted path found — caller must handle gracefully
}

function getGlobalNpmPrefix() {
  try {
    return execSync('npm root -g', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function isTrustedPath(p) {
  if (!p) return false;
  const normalized = p.replace(/\\/g, '/').toLowerCase();
  const tmpDir = os.tmpdir().replace(/\\/g, '/').toLowerCase();
  // Reject /tmp and os.tmpdir()
  if (normalized.startsWith('/tmp/') || normalized.startsWith(tmpDir + '/') || normalized === tmpDir) return false;
  // Reject world-writable patterns
  if (/\/(tmp|temp|public|world)\//i.test(normalized)) return false;
  return true;
}

// ── normalizePath ─────────────────────────────────────────────────────────────
// Expands ~ to os.homedir(), resolves to absolute, normalizes separators,
// removes trailing slash, lowercases on Windows only (per spec §4.1).
function normalizePath(p) {
  if (typeof p !== 'string') return '';

  // Expand ~ to home directory
  let expanded = p;
  if (expanded === '~') {
    expanded = os.homedir();
  } else if (expanded.startsWith('~' + path.sep) || expanded.startsWith('~/')) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  }

  // Resolve to absolute path and normalize separators
  let resolved = path.resolve(expanded);

  // Remove trailing separator (unless it's the root)
  if (resolved.length > 1 && (resolved.endsWith('/') || resolved.endsWith(path.sep))) {
    resolved = resolved.slice(0, -1);
  }

  // Lowercase on Windows only
  if (process.platform === 'win32') {
    resolved = resolved.toLowerCase();
  }

  return resolved;
}

// ── readConfig ────────────────────────────────────────────────────────────────
// Reads ~/.config/mcp-tasks/config.json, respects MCP_TASKS_CONFIG env var.
// Returns { projects: [], storageDir: ... } on any error.
function readConfig(configOverride) {
  const defaultConfig = {
    projects: [],
    storageDir: path.join(os.homedir(), '.mcp-tasks', 'tasks'),
  };

  const configPath = configOverride
    || process.env.MCP_TASKS_CONFIG
    || path.join(os.homedir(), '.config', 'mcp-tasks', 'config.json');

  try {
    if (!fs.existsSync(configPath)) return defaultConfig;
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultConfig;

    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      storageDir: typeof parsed.storageDir === 'string'
        ? parsed.storageDir
        : defaultConfig.storageDir,
    };
  } catch {
    return defaultConfig;
  }
}

// ── routeProject ──────────────────────────────────────────────────────────────
// Implements three-step resolution:
//   1. CWD match: longest-ancestor wins
//   2. Prefix-hint match: case-insensitive
//   3. GEN GLOBAL fallback: auto-init GEN if not present, returns isGlobal: true
//
// Returns { prefix, tasksDir, isGlobal? } or null on lock contention.
function routeProject(cwd, projectHint, configOverride) {
  const config = readConfig(configOverride);
  const projects = config.projects;

  const normalizedCwd = normalizePath(cwd);

  // ── Step 1: CWD match ───────────────────────────────────────────────────────
  const candidates = projects.filter(proj => {
    if (!proj || !proj.path) return false;
    if (proj.prefix === 'GEN') return false; // GEN is the fallback, not a CWD candidate
    const normalizedProjPath = normalizePath(proj.path);
    // Match if normalizedCwd starts with normalizedProjPath + sep OR equals it exactly
    return (
      normalizedCwd === normalizedProjPath ||
      normalizedCwd.startsWith(normalizedProjPath + path.sep) ||
      // Windows: also check forward-slash separator
      (process.platform === 'win32' && normalizedCwd.startsWith(normalizedProjPath + '/'))
    );
  });

  if (candidates.length > 0) {
    // Sort by normalized path length descending — longer normalized path = more specific.
    // Must use normalized length (not raw proj.path) to handle ~, relative, and trailing-sep differences.
    candidates.sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length);
    const best = candidates[0];
    return {
      prefix: best.prefix,
      tasksDir: best.tasksDir || path.join(best.path, 'agent-tasks'),
    };
  }

  // ── Step 2: Prefix-hint match ───────────────────────────────────────────────
  if (projectHint != null) {
    const hintLower = projectHint.toLowerCase();
    const hintMatch = projects.find(
      proj => proj && proj.prefix && proj.prefix.toLowerCase() === hintLower,
    );
    if (hintMatch) {
      return {
        prefix: hintMatch.prefix,
        tasksDir: hintMatch.tasksDir || path.join(hintMatch.path, 'agent-tasks'),
      };
    }
  }

  // ── Step 3: GEN GLOBAL fallback ─────────────────────────────────────────────
  // Check if GEN already exists in config
  const existingGen = projects.find(p => p && p.prefix === 'GEN');
  if (existingGen) {
    return {
      prefix: 'GEN',
      tasksDir: existingGen.tasksDir || path.join(os.homedir(), '.mcp-tasks', 'tasks', 'gen'),
      isGlobal: true,
    };
  }

  // GEN does not exist — auto-init (spec §7.2)
  return initGenProject(config, configOverride);
}

// ── initGenProject ─────────────────────────────────────────────────────────────
// Auto-initializes the GEN global project.
// Uses atomic O_EXCL lock, stale-lock cleanup (35s TTL), spawnSync to init GEN,
// fallback to manual config write with temp-file atomic rename.
// Returns { prefix: 'GEN', tasksDir: ..., isGlobal: true } or null on lock contention.
function initGenProject(config, configOverride) {
  const configPath = configOverride
    || process.env.MCP_TASKS_CONFIG
    || path.join(os.homedir(), '.config', 'mcp-tasks', 'config.json');

  const configDir = path.dirname(configPath);
  const lockFile = path.join(configDir, '.gen-init.lock');
  const genTasksDir = path.join(os.homedir(), '.mcp-tasks', 'tasks', 'gen');

  // Ensure config directory exists
  try {
    fs.mkdirSync(configDir, { recursive: true });
  } catch { /* ignore */ }

  // Stale-lock cleanup: remove lock if older than 35s
  try {
    if (fs.existsSync(lockFile)) {
      const stat = fs.statSync(lockFile);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > 35000) {
        fs.unlinkSync(lockFile);
      }
    }
  } catch { /* ignore */ }

  // Attempt to acquire O_EXCL atomic lock
  let lockFd = null;
  try {
    lockFd = fs.openSync(lockFile, 'wx'); // O_CREAT | O_EXCL
  } catch {
    // Lock already held by another process
    process.stderr.write('[project-router] GEN init lock contention — skipping\n');
    return null;
  }

  try {
    // Write our PID into the lock file
    fs.writeSync(lockFd, String(process.pid));
    fs.closeSync(lockFd);
    lockFd = null;

    // Try agent-tasks init GEN via spawnSync
    const binary = resolveBinary('agent-tasks');
    const genHomePath = path.join(os.homedir(), '.mcp-tasks');
    if (binary) {
      const initResult = spawnSync(binary, ['init', 'GEN', '--path', genHomePath, '--tasks-dir', genTasksDir], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000,
      });
      if (initResult.status === 0) {
        return { prefix: 'GEN', tasksDir: genTasksDir, isGlobal: true };
      }
      process.stderr.write(`[project-router] agent-tasks init GEN failed (${initResult.status}), using manual config write\n`);
    } else {
      process.stderr.write('[project-router] agent-tasks binary not found — using manual config write\n');
    }

    // init failed or binary unavailable — fallback: manual config write with temp-file atomic rename
    manualWriteGenConfig(configPath, genTasksDir, genHomePath);
    return { prefix: 'GEN', tasksDir: genTasksDir, isGlobal: true };

  } finally {
    // Release lock
    if (lockFd !== null) {
      try { fs.closeSync(lockFd); } catch { /* ignore */ }
    }
    try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
  }
}

// ── manualWriteGenConfig ──────────────────────────────────────────────────────
// Reads the current config, merges in a GEN entry, and writes via temp-file
// atomic rename to avoid partial writes.
function manualWriteGenConfig(configPath, genTasksDir, genHomePath) {
  try {
    // Read current config (may or may not exist)
    let current = { projects: [], storageDir: path.join(os.homedir(), '.mcp-tasks', 'tasks') };
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          current = {
            projects: Array.isArray(parsed.projects) ? parsed.projects : [],
            storageDir: typeof parsed.storageDir === 'string' ? parsed.storageDir : current.storageDir,
          };
        }
      } catch { /* use defaults */ }
    }

    // Merge GEN entry (avoid duplicate)
    const alreadyHasGen = current.projects.some(p => p && p.prefix === 'GEN');
    if (!alreadyHasGen) {
      current.projects.push({
        prefix: 'GEN',
        path: genHomePath,
        tasksDir: genTasksDir,
      });
    }

    // Write to temp file then rename (atomic)
    const tmpPath = `${configPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(current, null, 2), 'utf-8');
    fs.renameSync(tmpPath, configPath);
  } catch (err) {
    process.stderr.write(`[project-router] manual config write failed: ${err.message}\n`);
  }
}

// ── exports ───────────────────────────────────────────────────────────────────
module.exports = {
  routeProject,
  normalizePath,
  readConfig,
};

// No side-effects when require()-d.
