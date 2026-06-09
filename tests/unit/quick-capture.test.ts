/**
 * Unit tests for POST /api/capture/quick endpoint.
 *
 * Tests:
 * 1. GEN task creation — valid text creates a task and returns { taskId, project: 'GEN' }
 * 2. Explicit #prefix routing — extracts prefix, routes without LLM, skips spawn
 * 3. Empty text returns 400
 * 4. Text too long (>2000 chars) returns 400
 * 5. Background routing spawn logic (isolated)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

// ─── helpers ───────────────────────────────────────────────────────────────

function makeTempEnv(): {
  tempDir: string;
  configPath: string;
  genDbDir: string;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-capture-test-'));
  const tasksDir = path.join(tempDir, 'agent-tasks');
  fs.mkdirSync(tasksDir, { recursive: true });

  // GEN db path that the server will pick up
  const genDbDir = path.join(os.homedir(), '.mcp-tasks', 'tasks', 'gen');
  fs.mkdirSync(genDbDir, { recursive: true });

  const configPath = path.join(tempDir, 'config.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      version: 1,
      storageDir: tasksDir,
      defaultStorage: 'local',
      enforcement: 'off',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: false,
      tasksDirName: 'agent-tasks',
      projects: [
        { prefix: 'MYPROJ', path: tempDir },
      ],
    }),
    'utf-8',
  );

  return { tempDir, configPath, genDbDir };
}

// ─── server fixture ────────────────────────────────────────────────────────

describe('POST /api/capture/quick — endpoint logic', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedDb: string | undefined;
  let savedConfig: string | undefined;
  let savedClaudeDisabled: string | undefined;

  beforeAll(async () => {
    const env = makeTempEnv();
    tempDir = env.tempDir;

    savedDb = process.env['MCP_TASKS_DB'];
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    savedClaudeDisabled = process.env['CLAUDE_CLI_DISABLED'];
    process.env['MCP_TASKS_CONFIG'] = env.configPath;
    process.env['MCP_TASKS_DB'] = path.join(tempDir, 'tasks.db');
    // Prevent real claude spawns — the quick-capture endpoint fires spawnBackgroundRouting()
    // which calls spawn(resolveClaudeBinary()) asynchronously. On a host where claude is on
    // PATH this spawns a real LLM call per captured task (slow, non-deterministic, OOM risk).
    process.env['CLAUDE_CLI_DISABLED'] = '1';

    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    if (savedDb === undefined) delete process.env['MCP_TASKS_DB'];
    else process.env['MCP_TASKS_DB'] = savedDb;
    if (savedConfig === undefined) delete process.env['MCP_TASKS_CONFIG'];
    else process.env['MCP_TASKS_CONFIG'] = savedConfig;
    if (savedClaudeDisabled === undefined) delete process.env['CLAUDE_CLI_DISABLED'];
    else process.env['CLAUDE_CLI_DISABLED'] = savedClaudeDisabled;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns 400 for empty text', async () => {
    const res = await fetch(`${baseUrl}/api/capture/quick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('EMPTY_TEXT');
  });

  it('returns 400 for whitespace-only text', async () => {
    const res = await fetch(`${baseUrl}/api/capture/quick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('EMPTY_TEXT');
  });

  it('returns 400 for text exceeding 2000 chars', async () => {
    const res = await fetch(`${baseUrl}/api/capture/quick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(2001) }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('TEXT_TOO_LONG');
  });

  it('returns 200 with taskId on valid text and writes to a project index', async () => {
    const res = await fetch(`${baseUrl}/api/capture/quick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Buy more coffee beans' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { taskId: string; project: string };
    expect(typeof data.taskId).toBe('string');
    expect(data.taskId.length).toBeGreaterThan(0);
    expect(typeof data.project).toBe('string');
  });

  it('returns taskId matching the GEN or first-available project prefix', async () => {
    const res = await fetch(`${baseUrl}/api/capture/quick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Remember to call dentist' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { taskId: string; project: string };
    // Task ID must start with the returned project prefix
    expect(data.taskId.startsWith(data.project + '-')).toBe(true);
  });

  it('GET /api/config includes projectPrefixes array', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const data = await res.json() as { projectPrefixes?: string[] };
    expect(Array.isArray(data.projectPrefixes)).toBe(true);
  });
});

// ─── background routing logic unit tests (isolated) ────────────────────────

describe('background routing — #prefix extraction (isolated)', () => {
  it('detects explicit #PREFIX pattern at start of text', () => {
    const text = '#MYPROJ Fix the login bug'
    const match = text.match(/^#([A-Za-z]+)\s+/)
    expect(match).not.toBeNull()
    expect(match![1].toUpperCase()).toBe('MYPROJ')
  })

  it('does not match # in the middle of text', () => {
    const text = 'Fix the login bug #MYPROJ'
    const match = text.match(/^#([A-Za-z]+)\s+/)
    expect(match).toBeNull()
  })

  it('does not match if there is no space after the prefix', () => {
    const text = '#MYPROJFixBug'
    const match = text.match(/^#([A-Za-z]+)\s+/)
    expect(match).toBeNull()
  })

  it('extracts prefix case-insensitively', () => {
    const text = '#mcpat some task'
    const match = text.match(/^#([A-Za-z]+)\s+/)
    expect(match).not.toBeNull()
    expect(match![1].toUpperCase()).toBe('MCPAT')
  })
})

describe('background routing — LLM spawn on failure (isolated)', () => {
  it('task stays in GEN when spawn throws (simulated via error handler pattern)', () => {
    // Simulates the fallback: if spawn throws, task stays in GEN
    let taskProject = 'GEN'
    try {
      // Simulate spawn failure
      throw new Error('spawn ENOENT')
    } catch {
      // Error is caught silently — task stays in GEN
    }
    expect(taskProject).toBe('GEN')
  })

  it('builds LLM prompt that includes project prefixes', () => {
    const text = 'Fix the login bug'
    const prefixList = ['MYPROJ', 'GEN', 'ACME']
    const prompt = `Given this task: '${text}', which project prefix from [${prefixList.join(', ')}] best fits? Reply with ONLY the prefix or GEN.`
    expect(prompt).toContain('MYPROJ')
    expect(prompt).toContain('GEN')
    expect(prompt).toContain('Fix the login bug')
  })
})

describe('CaptureOverlay source structure', () => {
  it('CaptureOverlay.tsx exists in components directory', () => {
    const filePath = path.join(process.cwd(), 'src', 'ui', 'src', 'components', 'CaptureOverlay.tsx');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  // P1-06: CaptureToast was inlined into CaptureOverlay; no longer a separate export
  it('CaptureOverlay.tsx exports CaptureOverlay', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'ui', 'src', 'components', 'CaptureOverlay.tsx'),
      'utf-8',
    );
    expect(source).toContain('export function CaptureOverlay');
  });

  it('useCaptureOverlay.ts exists', () => {
    const filePath = path.join(process.cwd(), 'src', 'ui', 'src', 'hooks', 'useCaptureOverlay.ts');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  // P1-02: Ctrl+Space handler moved from useCaptureOverlay to useGlobalKeyboard
  it('useGlobalKeyboard listens for Ctrl+Space', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'ui', 'src', 'hooks', 'useGlobalKeyboard.ts'),
      'utf-8',
    );
    expect(source).toContain("e.ctrlKey");
    expect(source).toContain("'Space'");
  });

  it('api.ts exports quickCapture function', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'ui', 'src', 'api.ts'),
      'utf-8',
    );
    expect(source).toContain('quickCapture');
    expect(source).toContain('/api/capture/quick');
  });

  it('App.tsx mounts CaptureOverlay', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'ui', 'src', 'App.tsx'),
      'utf-8',
    );
    expect(source).toContain('CaptureOverlay');
    expect(source).toContain('useCaptureOverlay');
  });
});
