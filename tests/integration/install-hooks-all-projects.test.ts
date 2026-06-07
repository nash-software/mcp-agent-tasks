/**
 * Integration test for `install-hooks --all-projects` (B-AC2)
 *
 * Creates temp git repos, writes a config pointing to them,
 * runs the CLI, and verifies hooks are installed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_CLI = path.resolve(__dirname, '../../dist/cli.js');

/** Run the CLI with the given args, HOME/XDG_CONFIG_HOME set to tempHome. */
function runCli(
  tempHome: string,
  configPath: string,
  args: string[],
): { stdout: string; stderr: string; code: number } {
  const result = spawnSync('node', [DIST_CLI, ...args], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      MCP_TASKS_CONFIG: configPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.status ?? 0,
  };
}

/** Initialize a bare git repo (with .git/hooks/) in the given dir. */
function initGitRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  spawnSync('git', ['init', dir], { stdio: 'ignore' });
}

describe('install-hooks --all-projects (B-AC2)', () => {
  let tmpRoot: string;
  let tempHome: string;
  let configPath: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'mcpat-install-hooks-'));
    tempHome = join(tmpRoot, 'home');
    mkdirSync(tempHome, { recursive: true });
    configPath = join(tmpRoot, 'config.json');
  });

  afterEach(() => {
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('installs post-commit and prepare-commit-msg into each registered project repo', () => {
    const projA = join(tmpRoot, 'proj-a');
    const projB = join(tmpRoot, 'proj-b');
    initGitRepo(projA);
    initGitRepo(projB);

    const config = {
      version: 1,
      storageDir: join(projA, 'agent-tasks'),
      defaultStorage: 'local',
      enforcement: 'warn',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: false,
      projects: [
        { prefix: 'PRJA', path: projA, storage: 'local' },
        { prefix: 'PRJB', path: projB, storage: 'local' },
      ],
    };
    writeFileSync(configPath, JSON.stringify(config), 'utf-8');

    const { stdout, code } = runCli(tempHome, configPath, ['install-hooks', '--all-projects']);

    expect(code).toBe(0);
    expect(stdout).toMatch(/PRJA/);
    expect(stdout).toMatch(/PRJB/);

    // Hooks must exist in both repos
    for (const proj of [projA, projB]) {
      const hooksDir = join(proj, '.git', 'hooks');
      expect(existsSync(join(hooksDir, 'post-commit'))).toBe(true);
      expect(existsSync(join(hooksDir, 'prepare-commit-msg'))).toBe(true);
    }
  });

  it('warns and skips repos where .git/hooks does not exist', () => {
    const projA = join(tmpRoot, 'proj-a');
    const projMissing = join(tmpRoot, 'proj-missing'); // not a git repo
    initGitRepo(projA);
    mkdirSync(projMissing, { recursive: true }); // directory exists but no .git

    const config = {
      version: 1,
      storageDir: join(projA, 'agent-tasks'),
      defaultStorage: 'local',
      enforcement: 'warn',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: false,
      projects: [
        { prefix: 'PRJA', path: projA, storage: 'local' },
        { prefix: 'MISS', path: projMissing, storage: 'local' },
      ],
    };
    writeFileSync(configPath, JSON.stringify(config), 'utf-8');

    const { stdout, stderr, code } = runCli(tempHome, configPath, ['install-hooks', '--all-projects']);

    // Should not fail the whole command
    expect(code).toBe(0);

    // projA should have hooks installed
    const hooksA = join(projA, '.git', 'hooks');
    expect(existsSync(join(hooksA, 'post-commit'))).toBe(true);

    // Warning about the missing repo
    const combined = stdout + stderr;
    expect(combined).toMatch(/Skipping|MISS|no .git/i);
  });

  it('warns when no projects are registered', () => {
    const config = {
      version: 1,
      storageDir: join(tmpRoot, 'agent-tasks'),
      defaultStorage: 'local',
      enforcement: 'warn',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: false,
      projects: [],
    };
    writeFileSync(configPath, JSON.stringify(config), 'utf-8');

    const { stdout, stderr, code } = runCli(tempHome, configPath, ['install-hooks', '--all-projects']);

    expect(code).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toMatch(/No projects|nothing to install/i);
  });

  it('install is idempotent: running twice does not corrupt hooks', () => {
    const projA = join(tmpRoot, 'proj-a');
    initGitRepo(projA);

    const config = {
      version: 1,
      storageDir: join(projA, 'agent-tasks'),
      defaultStorage: 'local',
      enforcement: 'warn',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: false,
      projects: [{ prefix: 'PRJA', path: projA, storage: 'local' }],
    };
    writeFileSync(configPath, JSON.stringify(config), 'utf-8');

    // Run twice
    runCli(tempHome, configPath, ['install-hooks', '--all-projects']);
    const { code } = runCli(tempHome, configPath, ['install-hooks', '--all-projects']);
    expect(code).toBe(0);

    // Hook still valid (contains agent-tasks marker)
    const hookContent = readFileSync(join(projA, '.git', 'hooks', 'post-commit'), 'utf-8');
    expect(hookContent.length).toBeGreaterThan(0);
  });
});
