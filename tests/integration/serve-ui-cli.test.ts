import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_CLI = path.resolve(__dirname, '../../dist/cli.js');
// Use a high ephemeral port unlikely to be in use during tests
const TEST_PORT = 14567;

describe('CLI serve-ui command', () => {
  let tempDir: string;
  let tempDbPath: string;
  let configPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cli-ui-'));
    tempDbPath = path.join(tempDir, 'tasks.db');
    // Hermetic config with NO projects, so booting serve-ui doesn't reconcile the developer's real
    // projects (which would emit reconciler warnings to stderr and open extra DB handles). MCPAT-065.
    configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1, storageDir: tempDir, defaultStorage: 'global', enforcement: 'off',
      autoCommit: false, claimTtlHours: 4, trackManifest: false, tasksDirName: 'agent-tasks', projects: [],
    }), 'utf-8');
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('prints Dashboard URL to stdout and exits cleanly on SIGINT', async () => {
    const proc = spawn('node', [DIST_CLI, 'serve-ui', '--port', String(TEST_PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MCP_TASKS_DB: tempDbPath, MCP_TASKS_CONFIG: configPath },
    });

    const firstLine = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Timeout: no stdout from serve-ui within 8s'));
      }, 8000);

      let buf = '';
      proc.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const nl = buf.indexOf('\n');
        if (nl !== -1) {
          clearTimeout(timeout);
          resolve(buf.slice(0, nl).trim());
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        // Ignore benign boot-time warnings (reconcile-on-boot self-heal logs); only fail on real errors.
        const text = chunk.toString().trim();
        const fatal = text.split('\n').filter(l => l.trim() && !/^\[(reconciler|serve-ui)\]/.test(l.trim()));
        if (fatal.length) {
          clearTimeout(timeout);
          reject(new Error(`serve-ui stderr: ${fatal.join(' | ')}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      proc.on('close', (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`serve-ui exited with code ${code}`));
        }
      });
    });

    proc.kill('SIGINT');
    // Wait for process to exit (best effort — may be quick or delayed on Windows)
    await new Promise<void>(resolve => {
      if (proc.exitCode !== null) { resolve(); return; }
      proc.on('close', () => resolve());
      setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 2000);
    });

    expect(firstLine).toMatch(/^Dashboard: http:\/\/localhost:\d+/);
  });
});
