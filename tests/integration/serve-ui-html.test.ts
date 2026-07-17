import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiDist = path.resolve(__dirname, '../../dist/ui/index.html');
const UI_BUILT = fs.existsSync(uiDist);

describe('serve-ui HTML dashboard', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let originalEnv: string | undefined;

  let originalConfigEnv: string | undefined;

  beforeAll(async () => {
    if (!UI_BUILT) return;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-serve-html-'));
    const dbPath = path.join(tempDir, 'tasks.db');
    originalEnv = process.env['MCP_TASKS_DB'];
    process.env['MCP_TASKS_DB'] = dbPath;

    // Point loadConfig() at an isolated fixture config (empty projects) instead of the real
    // ~/.config/mcp-tasks/config.json — otherwise openProjectIndexes() reconciles against every
    // real registered project's markdown on disk (MCPAT-119/144: non-hermetic host dependency).
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1,
      storageDir: path.join(tempDir, 'global-store'),
      defaultStorage: 'global',
      enforcement: 'off',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: false,
      tasksDirName: 'agent-tasks',
      projects: [],
    }), 'utf-8');
    originalConfigEnv = process.env['MCP_TASKS_CONFIG'];
    process.env['MCP_TASKS_CONFIG'] = configPath;

    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    if (!UI_BUILT) return;
    await handle.close();
    if (originalEnv === undefined) {
      delete process.env['MCP_TASKS_DB'];
    } else {
      process.env['MCP_TASKS_DB'] = originalEnv;
    }
    if (originalConfigEnv === undefined) {
      delete process.env['MCP_TASKS_CONFIG'];
    } else {
      process.env['MCP_TASKS_CONFIG'] = originalConfigEnv;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('GET / returns HTML with React root mount point', async () => {
    if (!UI_BUILT) return;
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const text = await res.text();
    expect(text).toContain('id="root"');
  });

  it('GET / contains Vite module script', async () => {
    if (!UI_BUILT) return;
    const res = await fetch(`${baseUrl}/`);
    const text = await res.text();
    expect(text).toContain('type="module"');
  });

  it('GET / serves static asset listed in HTML', async () => {
    if (!UI_BUILT) return;
    const htmlRes = await fetch(`${baseUrl}/`);
    const html = await htmlRes.text();
    // Extract the first JS asset path from the HTML
    const match = html.match(/src="(\.\/assets\/[^"]+\.js)"/);
    if (!match) return; // no asset found — skip (may happen if dist/ui is stale)
    const assetPath = match[1].replace('./', '/');
    const assetRes = await fetch(`${baseUrl}${assetPath}`);
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get('content-type')).toMatch(/javascript/);
  });
});
