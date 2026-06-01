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
    let openIdx: { close(): void } | null = null;

    beforeEach(() => {
      tmpDir = makeTempDir();
      openIdx = null;
    });

    afterEach(async () => {
      // Always close the DB (even if an assertion threw) so the temp-dir unlink doesn't hit a held handle,
      // and give Windows a tick to release the WAL/-shm files before rmSync (avoids flaky EBUSY).
      try { openIdx?.close(); } catch { /* already closed */ }
      openIdx = null;
      await new Promise(r => setTimeout(r, 30));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // Build a ctx backed by a REAL StoreRegistry + shared SqliteIndex (the MCP server's model).
    async function buildCtx(config: McpTasksConfig): Promise<ToolContext> {
      fs.mkdirSync(config.storageDir, { recursive: true });
      const { SqliteIndex } = await import('../../../src/store/sqlite-index.js');
      const { StoreRegistry } = await import('../../../src/store/store-registry.js');
      const { MarkdownStore } = await import('../../../src/store/markdown-store.js');
      const { ManifestWriter } = await import('../../../src/store/manifest-writer.js');
      const idx = new SqliteIndex(path.join(config.storageDir, 'tasks.db'));
      idx.init();
      openIdx = idx; // closed in afterEach
      const registry = new StoreRegistry(config, idx, new MarkdownStore(), new ManifestWriter());
      // Ensure every project's (storage-aware) tasks dir exists so createTask's atomic write can land.
      for (const p of config.projects) fs.mkdirSync(registry.getTasksDirForPrefix(p.prefix), { recursive: true });
      return makeCtx({
        config,
        index: idx as unknown as ToolContext['index'],
        store: registry as unknown as ToolContext['store'],
      });
    }

    it('throws PROJECT_NOT_FOUND when project not in config', async () => {
      const ctx = makeCtx({ config: makeConfig(tmpDir) });
      await expect(mod.execute({ project: 'UNKNOWN' }, ctx)).rejects.toThrow(McpTasksError);
      // Assert the contract-level error CODE, not just the class (codex r1 F1).
      await expect(mod.execute({ project: 'UNKNOWN' }, ctx)).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    });

    it('reconciles a GLOBAL-storage project from storageDir, not <path>/agent-tasks (MCPAT-062)', async () => {
      // Global markdown lives in storageDir; the OLD code looked in <path>/agent-tasks → count 0.
      const config = makeConfig(path.join(tmpDir, 'global'), [{ prefix: 'GLOB', path: path.join(tmpDir, 'glob-root'), storage: 'global' }]);
      const ctx = await buildCtx(config);
      const store = ctx.store.getStoreForPrefix('GLOB');
      store.createTask({ project: 'GLOB', title: 'g1', type: 'chore', priority: 'low', why: 'x' });
      const t2 = store.createTask({ project: 'GLOB', title: 'g2', type: 'chore', priority: 'low', why: 'x' });

      const result = await mod.execute({ project: 'GLOB' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { rebuilt: boolean; count: number; projects: Record<string, number> };
      expect(parsed.rebuilt).toBe(true);
      expect(parsed.count).toBe(2);
      expect(parsed.projects.GLOB).toBe(2);
      expect(ctx.index.getTask(t2.id)).not.toBeNull();
    });

    it('reconciles a LOCAL-storage project from <path>/agent-tasks (no regression)', async () => {
      const config = makeConfig(path.join(tmpDir, 'global'), [{ prefix: 'LOC', path: path.join(tmpDir, 'loc'), storage: 'local' }]);
      const ctx = await buildCtx(config);
      ctx.store.getStoreForPrefix('LOC').createTask({ project: 'LOC', title: 'l1', type: 'chore', priority: 'low', why: 'x' });
      const result = await mod.execute({ project: 'LOC' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { count: number };
      expect(parsed.count).toBe(1);
    });

    it('no-arg reconciles EVERY configured project with per-project counts', async () => {
      const config = makeConfig(path.join(tmpDir, 'global'), [
        { prefix: 'GLOB', path: path.join(tmpDir, 'glob-root'), storage: 'global' },
        { prefix: 'LOC', path: path.join(tmpDir, 'loc'), storage: 'local' },
      ]);
      const ctx = await buildCtx(config);
      ctx.store.getStoreForPrefix('GLOB').createTask({ project: 'GLOB', title: 'g1', type: 'chore', priority: 'low', why: 'x' });
      ctx.store.getStoreForPrefix('LOC').createTask({ project: 'LOC', title: 'l1', type: 'chore', priority: 'low', why: 'x' });
      const result = await mod.execute({}, ctx);
      const parsed = JSON.parse(result.content[0].text) as { count: number; projects: Record<string, number> };
      expect(parsed.count).toBe(2);
      expect(parsed.projects.GLOB).toBe(1);
      expect(parsed.projects.LOC).toBe(1);
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
