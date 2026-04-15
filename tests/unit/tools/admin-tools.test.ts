import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpTasksError } from '../../../src/types/errors.js';
import type { ToolContext } from '../../../src/tools/context.js';
import type { McpTasksConfig } from '../../../src/config/loader.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-admin-test-'));
}

function makeConfig(storageDir: string, projects: McpTasksConfig['projects'] = []): McpTasksConfig {
  return {
    version: 1,
    storageDir,
    defaultStorage: 'global',
    enforcement: 'warn',
    tasksDirName: 'agent-tasks',
    autoCommit: false,
    claimTtlHours: 4,
    trackManifest: true,
    projects,
  };
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    store: {} as ToolContext['store'],
    index: {
      getTask: vi.fn(),
      listTasks: vi.fn(),
    } as unknown as ToolContext['index'],
    sessionId: 'test-session',
    config: makeConfig('/tmp/mcp-tasks'),
    milestones: {} as unknown as ToolContext['milestones'],
    ...overrides,
  };
}

// --- task-init ---

describe('task_init', async () => {
  const mod = await import('../../../src/tools/task-init.js');
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    configPath = path.join(tmpDir, 'test-config.json');
    // Point MCP_TASKS_CONFIG to a temp location so we don't write to real home
    process.env['MCP_TASKS_CONFIG'] = configPath;
  });

  afterEach(() => {
    delete process.env['MCP_TASKS_CONFIG'];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('validate()', () => {
    it('throws when project_prefix is missing', () => {
      expect(() => mod.validate({})).toThrow(McpTasksError);
    });

    it('throws when storage_mode is invalid', () => {
      expect(() => mod.validate({ project_prefix: 'X', storage_mode: 'remote' })).toThrow(McpTasksError);
    });

    it('passes with just project_prefix', () => {
      expect(() => mod.validate({ project_prefix: 'HERALD' })).not.toThrow();
    });
  });

  describe('execute() with local storage', () => {
    it('creates tasks/, archive/, and .gitignore directories', async () => {
      const projectPath = path.join(tmpDir, 'myproject');
      fs.mkdirSync(projectPath, { recursive: true });

      const ctx = makeCtx({ config: makeConfig(tmpDir) });
      const result = await mod.execute(
        { project_prefix: 'TEST', project_path: projectPath, storage_mode: 'local' },
        ctx,
      );

      const parsed = JSON.parse(result.content[0].text) as { initialized: boolean; path: string };
      expect(parsed.initialized).toBe(true);

      const tasksDir = path.join(projectPath, 'agent-tasks');
      expect(fs.existsSync(tasksDir)).toBe(true);
      expect(fs.existsSync(path.join(tasksDir, 'archive'))).toBe(true);
      expect(fs.existsSync(path.join(tasksDir, '.gitignore'))).toBe(true);
    });

    it('is idempotent: running twice does not error', async () => {
      const projectPath = path.join(tmpDir, 'myproject2');
      fs.mkdirSync(projectPath, { recursive: true });

      const ctx = makeCtx({ config: makeConfig(tmpDir) });
      const input = { project_prefix: 'TEST', project_path: projectPath, storage_mode: 'local' as const };

      await expect(mod.execute(input, ctx)).resolves.not.toThrow();
      // Second call — config already has the project so it skips registration
      await expect(mod.execute(input, ctx)).resolves.not.toThrow();
    });
  });
});

// --- task-rebuild-index ---

describe('task_rebuild_index', async () => {
  const mod = await import('../../../src/tools/task-rebuild-index.js');

  describe('validate()', () => {
    it('passes with empty input', () => {
      expect(() => mod.validate({})).not.toThrow();
    });
  });

  describe('execute()', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('throws PROJECT_NOT_FOUND when project not in config', async () => {
      const ctx = makeCtx({ config: makeConfig(tmpDir) });
      await expect(mod.execute({ project: 'UNKNOWN' }, ctx)).rejects.toThrow(McpTasksError);
    });

    it('runs reconciler and returns rebuilt count', async () => {
      // projectConfig.path is the project root; task-rebuild-index appends tasksDirName
      const agentTasksDir = path.join(tmpDir, 'agent-tasks');
      fs.mkdirSync(agentTasksDir, { recursive: true });

      const config = makeConfig(tmpDir, [{ prefix: 'TEST', path: tmpDir, storage: 'local' }]);
      const { SqliteIndex } = await import('../../../src/store/sqlite-index.js');
      const dbPath = path.join(tmpDir, 'tasks.db');
      const idx = new SqliteIndex(dbPath);
      idx.init();

      const ctx = makeCtx({
        config,
        index: idx as unknown as ToolContext['index'],
      });

      const result = await mod.execute({ project: 'TEST' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { rebuilt: boolean; count: number };
      expect(parsed.rebuilt).toBe(true);
      expect(typeof parsed.count).toBe('number');

      idx.close();
    });
  });
});

// --- task-register-project ---

describe('task_register_project', async () => {
  const mod = await import('../../../src/tools/task-register-project.js');
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    configPath = path.join(tmpDir, 'test-config.json');
    process.env['MCP_TASKS_CONFIG'] = configPath;
  });

  afterEach(() => {
    delete process.env['MCP_TASKS_CONFIG'];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('validate()', () => {
    it('throws when prefix is missing', () => {
      expect(() => mod.validate({ path: '/some/path' })).toThrow(McpTasksError);
    });

    it('throws when path is missing', () => {
      expect(() => mod.validate({ prefix: 'TEST' })).toThrow(McpTasksError);
    });

    it('throws when storage is invalid', () => {
      expect(() => mod.validate({ prefix: 'TEST', path: '/x', storage: 'remote' })).toThrow(McpTasksError);
    });

    it('passes with valid input', () => {
      expect(() => mod.validate({ prefix: 'TEST', path: '/x' })).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('registers a new project and writes config', async () => {
      const ctx = makeCtx({ config: makeConfig(tmpDir) });
      const result = await mod.execute({ prefix: 'NEWPROJ', path: '/some/project' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { registered: boolean; prefix: string; already_existed: boolean };

      expect(parsed.registered).toBe(true);
      expect(parsed.prefix).toBe('NEWPROJ');
      expect(parsed.already_existed).toBe(false);

      // Config should have been written to configPath
      expect(fs.existsSync(configPath)).toBe(true);
      const written = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { projects: Array<{ prefix: string }> };
      expect(written.projects.some((p) => p.prefix === 'NEWPROJ')).toBe(true);
    });

    it('is idempotent: registering existing prefix returns already_existed=true', async () => {
      const existingProject = { prefix: 'EXISTING', path: '/x', storage: 'global' as const };
      const ctx = makeCtx({ config: makeConfig(tmpDir, [existingProject]) });

      const result = await mod.execute({ prefix: 'EXISTING', path: '/x' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { already_existed: boolean };
      expect(parsed.already_existed).toBe(true);
    });
  });
});
