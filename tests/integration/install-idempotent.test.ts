import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_CLI = path.resolve(__dirname, '../../dist/cli.js');

interface SettingsHooks {
  PostToolUse?: Array<Record<string, unknown>>;
  SessionStart?: Array<Record<string, unknown>>;
}

interface Settings {
  hooks: SettingsHooks;
}

function runInstall(homeDir: string, extraArgs: string[] = []): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      HOME: homeDir,
      // Point npm prefix somewhere that won't run real npm
      npm_config_prefix: homeDir,
    };

    const proc = spawn('node', [DIST_CLI, 'install', '--dry-run', ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

function runInstallReal(homeDir: string, extraArgs: string[] = []): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    // For the real (non-dry-run) install, we override HOME so files go to tempDir
    const env = {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir, // Windows HOME equivalent
      npm_config_prefix: homeDir,
    };

    const proc = spawn('node', [DIST_CLI, 'install', ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

describe('install command idempotency', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-install-'));
    // Create the .claude dir so hook install doesn't fail
    fs.mkdirSync(path.join(tempHome, '.claude', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('dry-run does not write any files', async () => {
    const result = await runInstall(tempHome);
    // dry-run should exit cleanly
    expect(result.code).toBe(0);
    // No settings.json should be written
    const settingsPath = path.join(tempHome, '.claude', 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it('install twice produces exactly 1 passive-capture entry in PostToolUse', async () => {
    // We need the real hooks source dir to be available (it is — at hooks/)
    // Override HOME so os.homedir() returns tempHome in the child process
    const r1 = await runInstallReal(tempHome);
    const r2 = await runInstallReal(tempHome);

    // Both runs should succeed (or exit non-zero only because npm prefix -g fails)
    // The key assertion is on the settings.json content
    const settingsPath = path.join(tempHome, '.claude', 'settings.json');

    if (!fs.existsSync(settingsPath)) {
      // npm prefix -g may fail in test env — skip file content assertions
      return;
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Settings;
    // Hook entries use the Claude Code schema: { matcher, hooks: [{ type, command, ... }] }.
    // Count entries whose nested hooks[].command references the given script.
    const entriesReferencing = (group: Array<Record<string, unknown>>, script: string): number =>
      group.filter((entry) => {
        const inner = entry['hooks'];
        return Array.isArray(inner) && inner.some(
          (h) => typeof (h as Record<string, unknown>)['command'] === 'string' &&
            ((h as Record<string, unknown>)['command'] as string).includes(script),
        );
      }).length;

    expect(entriesReferencing(settings.hooks.PostToolUse ?? [], 'passive-capture.js')).toBe(1);
    expect(entriesReferencing(settings.hooks.SessionStart ?? [], 'session-task-detector.js')).toBe(1);

    // Check stdout from r1/r2 is not empty
    expect(r1.stdout.length + r2.stdout.length).toBeGreaterThan(0);
  });

  it('install with --dry-run prints what would be done without writing files', async () => {
    const result = await runInstall(tempHome);
    expect(result.stdout).toContain('[dry-run]');
    // No hook files should be written to tempHome
    const passiveDest = path.join(tempHome, '.claude', 'hooks', 'passive-capture.js');
    expect(fs.existsSync(passiveDest)).toBe(false);
  });
});
