/**
 * Tests for hooks/lib/project-router.js
 * Uses MCP_TASKS_CONFIG env var pointing to temp fixture config files for isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROUTER_PATH = path.resolve('hooks/lib/project-router.js');

// Dynamically require so we get a fresh load each time (no ESM caching issues)
function loadRouter(): {
  routeProject: (cwd: string, projectHint: string | null, configOverride?: string) => { prefix: string; tasksDir: string; isGlobal?: boolean } | null;
  normalizePath: (p: string) => string;
  readConfig: (configOverride?: string) => { projects: Array<{ prefix: string; path: string; tasksDir?: string }>; storageDir: string };
} {
  // Clear require cache to get a fresh module each time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  delete require.cache[require.resolve(ROUTER_PATH)];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(ROUTER_PATH);
}

function writeConfig(configPath: string, data: unknown): void {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8');
}

describe('project-router', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-test-'));
    configPath = path.join(tmpDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── normalizePath ───────────────────────────────────────────────────────────

  describe('normalizePath', () => {
    it('expands ~ to os.homedir()', () => {
      const { normalizePath } = loadRouter();
      const result = normalizePath('~/projects/foo');
      // On Windows, normalizePath lowercases; compare case-insensitively
      const expected = path.join(os.homedir(), 'projects', 'foo');
      expect(result.toLowerCase()).toBe(expected.toLowerCase());
    });

    it('removes trailing slash', () => {
      const { normalizePath } = loadRouter();
      const p = path.join(os.homedir(), 'projects', 'foo');
      const withSlash = p + path.sep;
      // On Windows, normalizePath lowercases; compare case-insensitively
      expect(normalizePath(withSlash).toLowerCase()).toBe(p.toLowerCase());
    });

    it('resolves to absolute path', () => {
      const { normalizePath } = loadRouter();
      // An already-absolute path should remain absolute
      const abs = path.join(os.homedir(), 'some', 'project');
      expect(path.isAbsolute(normalizePath(abs))).toBe(true);
    });

    it('lowercases on win32 (simulate via process.platform)', () => {
      // We test by checking that on win32 the path is lowercased,
      // and on posix it is not. We use process.platform directly.
      const { normalizePath } = loadRouter();
      const mixedPath = path.join(os.homedir(), 'MyProject', 'SomeFile');
      const result = normalizePath(mixedPath);
      if (process.platform === 'win32') {
        expect(result).toBe(result.toLowerCase());
      } else {
        // On POSIX, case is preserved (unless the path itself is lowercase)
        // We just verify it doesn't forcibly lowercase
        expect(result).toBe(path.resolve(mixedPath));
      }
    });
  });

  // ── readConfig ──────────────────────────────────────────────────────────────

  describe('readConfig', () => {
    it('returns default config on missing file', () => {
      const { readConfig } = loadRouter();
      const missing = path.join(tmpDir, 'nonexistent', 'config.json');
      const cfg = readConfig(missing);
      expect(cfg.projects).toEqual([]);
      expect(cfg.storageDir).toBeTruthy();
    });

    it('reads projects from a valid config file', () => {
      const { readConfig } = loadRouter();
      const data = {
        projects: [
          { prefix: 'FOO', path: '/code/foo', tasksDir: '/code/foo/agent-tasks' },
        ],
        storageDir: '/some/storage',
      };
      writeConfig(configPath, data);
      const cfg = readConfig(configPath);
      expect(cfg.projects).toHaveLength(1);
      expect(cfg.projects[0].prefix).toBe('FOO');
    });

    it('returns default on invalid JSON', () => {
      const { readConfig } = loadRouter();
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, 'NOT JSON', 'utf-8');
      const cfg = readConfig(configPath);
      expect(cfg.projects).toEqual([]);
    });
  });

  // ── routeProject — CWD match ────────────────────────────────────────────────

  describe('routeProject - CWD match', () => {
    it('selects the longest-path (most specific) ancestor when multiple projects match', () => {
      const { routeProject } = loadRouter();
      const data = {
        projects: [
          { prefix: 'ROOT', path: '/code', tasksDir: '/code/agent-tasks' },
          { prefix: 'MCA', path: '/code/mcp-agent-tasks', tasksDir: '/code/mcp-agent-tasks/agent-tasks' },
        ],
        storageDir: path.join(tmpDir, 'tasks'),
      };
      writeConfig(configPath, data);

      const result = routeProject('/code/mcp-agent-tasks/src', null, configPath);
      expect(result).not.toBeNull();
      expect(result!.prefix).toBe('MCA');
    });

    it('matches when CWD equals the project path exactly', () => {
      const { routeProject } = loadRouter();
      const data = {
        projects: [
          { prefix: 'EXACT', path: '/code/exact-project', tasksDir: '/code/exact-project/agent-tasks' },
        ],
        storageDir: path.join(tmpDir, 'tasks'),
      };
      writeConfig(configPath, data);

      const result = routeProject('/code/exact-project', null, configPath);
      expect(result).not.toBeNull();
      expect(result!.prefix).toBe('EXACT');
    });

    it('does not match a project whose path is merely a string prefix (not ancestor)', () => {
      const { routeProject } = loadRouter();
      // /code/mcp is NOT an ancestor of /code/mcp-agent-tasks — need path separator
      const data = {
        projects: [
          { prefix: 'MCP', path: '/code/mcp', tasksDir: '/code/mcp/agent-tasks' },
        ],
        storageDir: path.join(tmpDir, 'tasks'),
      };
      writeConfig(configPath, data);

      // CWD is /code/mcp-agent-tasks/src — /code/mcp is not a proper ancestor
      // This should fall through to GEN fallback (not prefix hint — no hint given)
      const result = routeProject('/code/mcp-agent-tasks/src', null, configPath);
      // GEN fallback → isGlobal: true (or null on lock contention, but we check it's not MCP)
      if (result !== null) {
        expect(result.prefix).not.toBe('MCP');
      }
    });
  });

  // ── routeProject — prefix-hint match ────────────────────────────────────────

  describe('routeProject - prefix-hint match', () => {
    it('uses hint when CWD does not match any project', () => {
      const { routeProject } = loadRouter();
      const data = {
        projects: [
          { prefix: 'HERALD', path: '/code/herald', tasksDir: '/code/herald/agent-tasks' },
        ],
        storageDir: path.join(tmpDir, 'tasks'),
      };
      writeConfig(configPath, data);

      // CWD doesn't match /code/herald, but hint does
      const result = routeProject('/some/other/dir', 'HERALD', configPath);
      expect(result).not.toBeNull();
      expect(result!.prefix).toBe('HERALD');
    });

    it('hint match is case-insensitive', () => {
      const { routeProject } = loadRouter();
      const data = {
        projects: [
          { prefix: 'HERALD', path: '/code/herald', tasksDir: '/code/herald/agent-tasks' },
        ],
        storageDir: path.join(tmpDir, 'tasks'),
      };
      writeConfig(configPath, data);

      const result = routeProject('/some/other/dir', 'herald', configPath);
      expect(result).not.toBeNull();
      expect(result!.prefix).toBe('HERALD');
    });

    it('returns GEN fallback when hint does not match any project', () => {
      const { routeProject } = loadRouter();
      const data = {
        projects: [
          { prefix: 'HERALD', path: '/code/herald', tasksDir: '/code/herald/agent-tasks' },
        ],
        storageDir: path.join(tmpDir, 'tasks'),
      };
      writeConfig(configPath, data);

      const result = routeProject('/some/other/dir', 'NOMATCH', configPath);
      // GEN fallback
      if (result !== null) {
        expect(result.isGlobal).toBe(true);
        expect(result.prefix).toBe('GEN');
      }
    });
  });

  // ── routeProject — GEN fallback ──────────────────────────────────────────────

  describe('routeProject - GEN fallback', () => {
    it('triggers GEN fallback when neither CWD nor hint matches; returns isGlobal: true', () => {
      const { routeProject } = loadRouter();
      // Config with GEN already present to skip auto-init
      const genTasksDir = path.join(tmpDir, 'gen-tasks');
      const data = {
        projects: [
          { prefix: 'GEN', path: os.homedir(), tasksDir: genTasksDir },
        ],
        storageDir: path.join(tmpDir, 'tasks'),
      };
      writeConfig(configPath, data);

      // Neither CWD (/nonexistent) nor hint (null) match any non-GEN project
      const result = routeProject('/nonexistent/path', null, configPath);
      // GEN is in config — should match it (CWD match with homedir, or direct return as GEN fallback)
      // The important thing: result is not null and prefix is GEN
      expect(result).not.toBeNull();
      expect(result!.prefix).toBe('GEN');
    });

    it('GEN auto-init skipped when GEN entry already exists in config', () => {
      const { routeProject } = loadRouter();
      // GEN already in config
      const genTasksDir = path.join(tmpDir, 'gen-tasks');
      const data = {
        projects: [
          { prefix: 'GEN', path: os.homedir(), tasksDir: genTasksDir },
        ],
        storageDir: path.join(tmpDir, 'tasks'),
      };
      writeConfig(configPath, data);

      // Watch for lock file creation — it should NOT be created since GEN exists
      const configDir = path.dirname(configPath);
      const lockFile = path.join(configDir, '.gen-init.lock');

      routeProject('/nonexistent/path', null, configPath);

      // Lock file should NOT have been created
      expect(fs.existsSync(lockFile)).toBe(false);
    });

    it('returns null on lock contention (lock file held by another process with future mtime)', () => {
      const { routeProject } = loadRouter();
      // Config with NO GEN entry so auto-init is triggered
      const data = {
        projects: [
          { prefix: 'OTHER', path: '/code/other', tasksDir: '/code/other/agent-tasks' },
        ],
        storageDir: path.join(tmpDir, 'tasks'),
      };
      writeConfig(configPath, data);

      // Pre-create a lock file with a future mtime so stale-cleanup skips it
      const configDir = path.dirname(configPath);
      const lockFile = path.join(configDir, '.gen-init.lock');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(lockFile, String(process.pid), 'utf-8');
      // Set mtime to future (now + 60s) so TTL cleanup leaves it alone
      const futureTime = new Date(Date.now() + 60000);
      fs.utimesSync(lockFile, futureTime, futureTime);

      const result = routeProject('/nonexistent/path', null, configPath);
      // Should return null due to lock contention
      expect(result).toBeNull();
    });
  });
});
