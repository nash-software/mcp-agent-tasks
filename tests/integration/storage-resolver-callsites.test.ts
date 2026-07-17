/**
 * MCPAT-142 — four call sites (cli.ts fix-id-collisions, triage/engine.ts, triage/audit.ts,
 * server-ui.ts openProjectIndexes) previously computed tasksDir as `join(p.path, tasksDirName)`
 * directly, ignoring a project's `storage: 'local'|'global'` field. For `storage: 'global'`
 * projects this pointed at the wrong directory (should be `config.storageDir`). This suite proves
 * all four call sites now agree with the canonical `resolveProjectTasksDir()` resolver for both
 * storage modes, and that the fix has real observable effect (collision detection, triage undo,
 * and dashboard boot all find markdown that lives in the correctly-resolved directory).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveProjectTasksDir, resolveServerDbPath, type McpTasksConfig } from '../../src/config/loader.js';
import { projectTasksDirs } from '../../src/triage/engine.js';
import { planCollisionFixes, type StoreRef } from '../../src/store/id-collision-fixer.js';
import { applyDecisions, writeRun, undoRun } from '../../src/triage/audit.js';
import type { TriageDecision } from '../../src/triage/types.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { MarkdownStore } from '../../src/store/markdown-store.js';
import { ManifestWriter } from '../../src/store/manifest-writer.js';
import { TaskStore } from '../../src/store/task-store.js';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

describe('MCPAT-142 — storage-blind call sites route through resolveProjectTasksDir', () => {
  let tempDir: string;
  let globalStoreDir: string;
  let localProjectRoot: string;
  let globalProjectRoot: string;
  let config: McpTasksConfig;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-resolver-'));
    globalStoreDir = path.join(tempDir, 'global-store');
    localProjectRoot = path.join(tempDir, 'local-project');
    globalProjectRoot = path.join(tempDir, 'global-project-repo');
    fs.mkdirSync(globalStoreDir, { recursive: true });
    fs.mkdirSync(path.join(localProjectRoot, 'agent-tasks'), { recursive: true });
    fs.mkdirSync(globalProjectRoot, { recursive: true });

    config = {
      version: 1,
      storageDir: globalStoreDir,
      defaultStorage: 'global',
      enforcement: 'off',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: false,
      tasksDirName: 'agent-tasks',
      projects: [
        { prefix: 'LOCP', path: localProjectRoot, storage: 'local' },
        { prefix: 'GLOP', path: globalProjectRoot, storage: 'global' },
      ],
    };
  });

  afterAll(() => {
    // audit.ts's internal buildStore() doesn't expose a handle to close its SqliteIndex, so on
    // Windows the WAL lock can outlive this test — swallow, matching tests/unit/triage-engine.test.ts.
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('resolves storage:local to <path>/<tasksDirName>', () => {
    expect(resolveProjectTasksDir(config.projects[0], config)).toBe(path.join(localProjectRoot, 'agent-tasks'));
  });

  it('resolves storage:global to config.storageDir, NOT <path>/<tasksDirName>', () => {
    const resolved = resolveProjectTasksDir(config.projects[1], config);
    expect(resolved).toBe(globalStoreDir);
    expect(resolved).not.toBe(path.join(globalProjectRoot, 'agent-tasks'));
  });

  it('triage/engine.ts projectTasksDirs() agrees with resolveProjectTasksDir for both storage modes', () => {
    const map = projectTasksDirs(config);
    for (const p of config.projects) {
      expect(map.get(p.prefix)).toBe(resolveProjectTasksDir(p, config));
    }
  });

  it("cli.ts's fix-id-collisions command source routes through resolveProjectTasksDir (not a naive join)", () => {
    // cli.ts's `fix-id-collisions` action is an unexported Commander closure, so it can't be
    // imported and called directly in a test. Bind this test to the real source instead of only
    // re-testing the resolver: assert the actual call site uses resolveProjectTasksDir.
    const src = fs.readFileSync(path.resolve('src/cli.ts'), 'utf-8');
    const storesLine = src.split('\n').find(l => l.includes('stores: StoreRef[]'));
    expect(storesLine).toBeDefined();
    expect(storesLine).toContain('resolveProjectTasksDir(p, config)');
    expect(storesLine).not.toContain('path.join(p.path');
  });

  it('cli.ts fix-id-collisions stores construction finds a collision seeded under the resolved global storageDir', () => {
    // Mirrors cli.ts's fix-id-collisions: stores = config.projects.map(p => ({ prefix, tasksDir: resolveProjectTasksDir(p, config) }))
    const stores: StoreRef[] = config.projects.map(p => ({ prefix: p.prefix, tasksDir: resolveProjectTasksDir(p, config) }));
    const glopStore = stores.find(s => s.prefix === 'GLOP')!;
    expect(glopStore.tasksDir).toBe(globalStoreDir);

    // Seed a genuine (id, project) collision directly under the CORRECTLY resolved directory.
    const fm = (id: string, title: string) =>
      `---\nid: ${id}\ntitle: "${title}"\nstatus: todo\ncreated: 2026-01-01T00:00:00.000Z\n---\n\nbody\n`;
    fs.writeFileSync(path.join(globalStoreDir, 'GLOP-001.md'), fm('GLOP-001', 'Canonical'), 'utf-8');
    fs.writeFileSync(path.join(globalStoreDir, 'GLOP-001-dup.md'), fm('GLOP-001', 'Duplicate'), 'utf-8');

    const plans = planCollisionFixes(stores);
    const glopPlan = plans.find(p => p.project === 'GLOP' && p.id === 'GLOP-001');
    expect(glopPlan).toBeDefined();
    expect(glopPlan?.reassign.length).toBe(1);

    // Regression guard: the OLD naive join would have looked in the wrong (non-existent) directory
    // and found nothing.
    const naiveTasksDir = path.join(globalProjectRoot, 'agent-tasks');
    const naiveStores: StoreRef[] = [{ prefix: 'GLOP', tasksDir: naiveTasksDir }];
    const naivePlans = planCollisionFixes(naiveStores);
    expect(naivePlans.length).toBe(0);
  });

  it('triage/audit.ts undoRun resolves a storage:global project tasksDir correctly and reverts the task', async () => {
    const dbPath = resolveServerDbPath(globalStoreDir, config, 'GLOP');
    const idx = new SqliteIndex(dbPath);
    idx.init();
    const markdownStore = new MarkdownStore();
    const manifestWriter = new ManifestWriter();
    const store = new TaskStore(markdownStore, idx, manifestWriter, globalStoreDir, 'GLOP');
    const task = store.createTask({ project: 'GLOP', title: 'Undo target', type: 'chore', priority: 'medium', why: 'test' });
    idx.close();

    const decisions: TriageDecision[] = [{
      taskId: task.id,
      project: 'GLOP',
      fromStatus: 'todo',
      toStatus: 'in_progress',
      path: ['todo', 'in_progress'],
      tier: 0,
      signal: 'test-signal',
      detail: 'test',
      evidenceHard: true,
    }];

    const tasksDirByPrefix = new Map<string, string>([['GLOP', globalStoreDir]]);
    const applyResult = await applyDecisions(decisions, config, tasksDirByPrefix);
    expect(applyResult.applied).toBe(1);
    expect(applyResult.failed).toBe(0);

    const runId = `test-${Date.now()}`;
    await writeRun(runId, applyResult.entries);

    // undoRun re-derives tasksDirByPrefix internally via resolveProjectTasksDir — this is the
    // call site under test. If it fell back to the naive join, it would not find the markdown
    // file under globalProjectRoot/agent-tasks (which doesn't exist) and the revert would fail.
    const undoResult = await undoRun(runId, config);
    expect(undoResult.reverted).toBe(1);
    expect(undoResult.failed).toBe(0);

    const idx2 = new SqliteIndex(dbPath);
    idx2.init();
    const reverted = idx2.getTask(task.id);
    idx2.close();
    expect(reverted?.status).toBe('todo');
  });

  describe('server-ui.ts openProjectIndexes', () => {
    let handle: UiServerHandle;
    let baseUrl: string;
    let bootTempDir: string;
    const saved: Record<string, string | undefined> = {};

    beforeAll(async () => {
      bootTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-resolver-boot-'));
      const bootGlobalStore = path.join(bootTempDir, 'global-store');
      const bootGlobalProjectRepo = path.join(bootTempDir, 'global-project-repo');
      fs.mkdirSync(bootGlobalStore, { recursive: true });
      fs.mkdirSync(bootGlobalProjectRepo, { recursive: true });

      const bootConfig: McpTasksConfig = {
        version: 1, storageDir: bootGlobalStore, defaultStorage: 'global', enforcement: 'off',
        autoCommit: false, claimTtlHours: 4, trackManifest: false, tasksDirName: 'agent-tasks',
        projects: [{ prefix: 'BOOTG', path: bootGlobalProjectRepo, storage: 'global' }],
      };
      const configPath = path.join(bootTempDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(bootConfig), 'utf-8');

      saved.MCP_TASKS_CONFIG = process.env['MCP_TASKS_CONFIG'];
      saved.MCP_TASKS_DB = process.env['MCP_TASKS_DB'];
      saved.MCP_TASKS_DIR = process.env['MCP_TASKS_DIR'];
      process.env['MCP_TASKS_CONFIG'] = configPath;
      delete process.env['MCP_TASKS_DB'];
      delete process.env['MCP_TASKS_DIR'];

      // AC1-style differential (mirrors reconcile-on-boot.test.ts): seed the markdown file under the
      // CORRECTLY resolved (global) tasksDir — resolveProjectTasksDir returns bootGlobalStore for a
      // storage:'global' project, not <path>/agent-tasks — then DELETE the index row so the task is
      // only discoverable via reconcile-on-boot's markdown scan of openProjectIndexes()'s resolved
      // tasksDir. If that resolution is a naive join(p.path, tasksDirName), the scan looks in the
      // (non-existent) bootGlobalProjectRepo/agent-tasks dir, finds nothing, and the task never
      // reappears in the index.
      const dbPath = resolveServerDbPath(bootGlobalStore, bootConfig, 'BOOTG');
      const idx = new SqliteIndex(dbPath);
      idx.init();
      const store = new TaskStore(new MarkdownStore(), idx, new ManifestWriter(), bootGlobalStore, 'BOOTG');
      const seeded = store.createTask({ project: 'BOOTG', title: 'Found via resolved global dir', type: 'chore', priority: 'medium', why: 'test' });
      idx.deleteTask(seeded.id);
      idx.close();

      handle = await startUiServer({ port: 0 });
      baseUrl = handle.url;
    });

    afterAll(async () => {
      await handle.close();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      fs.rmSync(bootTempDir, { recursive: true, force: true });
    });

    it('serves a task from a storage:global project whose markdown lives in the resolved storageDir', async () => {
      const res = await fetch(`${baseUrl}/api/tasks?project=BOOTG`);
      expect(res.status).toBe(200);
      const tasks = await res.json() as Array<{ title: string }>;
      expect(tasks.some(t => t.title === 'Found via resolved global dir')).toBe(true);
    });
  });
});
