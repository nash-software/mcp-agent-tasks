import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SqliteIndex } from '../../src/store/sqlite-index.js';

describe('build-task-summary script', () => {
  let tempDir: string;
  let tasksDir: string;
  let configPath: string;
  let savedConfig: string | undefined;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-summary-'));
    tasksDir = path.join(tempDir, 'agent-tasks');
    fs.mkdirSync(tasksDir, { recursive: true });

    configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1,
      storageDir: tasksDir,
      defaultStorage: 'local',
      enforcement: 'off',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: false,
      tasksDirName: 'agent-tasks',
      projects: [{ prefix: 'TST', path: tempDir, storage: 'local' }],
    }), 'utf-8');

    savedConfig = process.env['MCP_TASKS_CONFIG'];
    process.env['MCP_TASKS_CONFIG'] = configPath;

    const dbPath = path.join(tasksDir, '.index.db');
    const idx = new SqliteIndex(dbPath);
    idx.init();
    idx.ensureProject('TST');
    const now = new Date().toISOString();
    idx.upsertTask({
      schema_version: 1, id: 'TST-001', title: 'First task', type: 'feature',
      status: 'in_progress', priority: 'high', project: 'TST', tags: [],
      complexity: 3, complexity_manual: false, why: 'test',
      created: now, updated: now, last_activity: now,
      claimed_by: 'agent-1', claimed_at: now, claim_ttl_hours: 4,
      parent: null, children: [], dependencies: [], subtasks: [],
      git: { branch: 'feat/TST-001', commits: [] },
      transitions: [], files: [], body: '', file_path: 'TST-001.md',
      milestone: 'M-1',
    });
    idx.upsertTask({
      schema_version: 1, id: 'TST-002', title: 'Second task', type: 'bug',
      status: 'done', priority: 'medium', project: 'TST', tags: [],
      complexity: 1, complexity_manual: false, why: 'bugfix',
      created: now, updated: now, last_activity: now,
      claimed_by: null, claimed_at: null, claim_ttl_hours: 4,
      parent: null, children: [], dependencies: [], subtasks: [],
      git: { commits: [] },
      transitions: [], files: [], body: '', file_path: 'TST-002.md',
    });
    idx.close();
  });

  afterAll(() => {
    if (savedConfig === undefined) delete process.env['MCP_TASKS_CONFIG'];
    else process.env['MCP_TASKS_CONFIG'] = savedConfig;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('script file exists', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'build-task-summary.js');
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it('produces .summary.jsonl with one JSON line per task', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'build-task-summary.js');
    execFileSync('node', [scriptPath], {
      env: { ...process.env, MCP_TASKS_CONFIG: configPath },
      timeout: 10000,
    });
    const summaryPath = path.join(tasksDir, '.summary.jsonl');
    expect(fs.existsSync(summaryPath)).toBe(true);

    const lines = fs.readFileSync(summaryPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);

    for (const line of lines) {
      const obj = JSON.parse(line);
      expect(obj).toHaveProperty('id');
      expect(obj).toHaveProperty('title');
      expect(obj).toHaveProperty('status');
      expect(obj).toHaveProperty('type');
      expect(obj).toHaveProperty('priority');
      expect(obj).toHaveProperty('project');
      expect(obj).toHaveProperty('last_activity');
    }
  });

  it('includes optional fields when present and excludes task body', () => {
    const summaryPath = path.join(tasksDir, '.summary.jsonl');
    const lines = fs.readFileSync(summaryPath, 'utf-8').trim().split('\n');
    const task1 = JSON.parse(lines.find((l: string) => l.includes('TST-001'))!);
    expect(task1.milestone).toBe('M-1');
    expect(task1.branch).toBe('feat/TST-001');
    expect(task1.claimed_by).toBe('agent-1');

    const content = fs.readFileSync(summaryPath, 'utf-8');
    expect(content).not.toContain('"body"');
  });

  it('is idempotent — running twice produces identical output', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'build-task-summary.js');
    const summaryPath = path.join(tasksDir, '.summary.jsonl');

    execFileSync('node', [scriptPath], {
      env: { ...process.env, MCP_TASKS_CONFIG: configPath },
      timeout: 10000,
    });
    const first = fs.readFileSync(summaryPath, 'utf-8');

    execFileSync('node', [scriptPath], {
      env: { ...process.env, MCP_TASKS_CONFIG: configPath },
      timeout: 10000,
    });
    const second = fs.readFileSync(summaryPath, 'utf-8');

    expect(second).toBe(first);
  });
});
