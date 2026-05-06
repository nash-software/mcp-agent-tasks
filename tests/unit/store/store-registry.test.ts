import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StoreRegistry } from '../../../src/store/store-registry.js';
import { SqliteIndex } from '../../../src/store/sqlite-index.js';
import { MarkdownStore } from '../../../src/store/markdown-store.js';
import { ManifestWriter } from '../../../src/store/manifest-writer.js';
import { McpTasksError } from '../../../src/types/errors.js';
import type { McpTasksConfig } from '../../../src/config/loader.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-registry-test-'));
}

describe('StoreRegistry', () => {
  let tmpDir: string;
  let localProjectDir: string;
  let globalStorageDir: string;
  let dbPath: string;
  let idx: SqliteIndex;
  let markdownStore: MarkdownStore;
  let manifestWriter: ManifestWriter;
  let config: McpTasksConfig;

  beforeEach(() => {
    tmpDir = makeTempDir();
    localProjectDir = path.join(tmpDir, 'local-project');
    globalStorageDir = path.join(tmpDir, 'global-storage');

    fs.mkdirSync(localProjectDir, { recursive: true });
    fs.mkdirSync(globalStorageDir, { recursive: true });

    dbPath = path.join(tmpDir, 'tasks.db');
    idx = new SqliteIndex(dbPath);
    idx.init();

    markdownStore = new MarkdownStore();
    manifestWriter = new ManifestWriter();

    // Config: LOCAL project + two GLOBAL projects (MCPAT and NASH share global storage)
    config = {
      version: 1,
      storageDir: globalStorageDir,
      defaultStorage: 'global',
      enforcement: 'warn',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: true,
      tasksDirName: 'agent-tasks',
      projects: [
        {
          prefix: 'LOCAL',
          path: localProjectDir,
          storage: 'local',
        },
        {
          prefix: 'MCPAT',
          path: '/some/path',
          storage: 'global',
        },
        {
          prefix: 'NASH',
          path: '/other/path',
          storage: 'global',
        },
      ],
    };
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRegistry(): StoreRegistry {
    return new StoreRegistry(config, idx, markdownStore, manifestWriter);
  }

  // Test 1: Constructor registers all projects from config
  it('registers all projects from config without throwing', () => {
    expect(() => makeRegistry()).not.toThrow();
  });

  // Test 2: getStoreForPrefix('LOCAL') returns a store (no throw)
  it('getStoreForPrefix returns a store for a known prefix', () => {
    const registry = makeRegistry();
    expect(() => registry.getStoreForPrefix('LOCAL')).not.toThrow();
    const store = registry.getStoreForPrefix('LOCAL');
    expect(store).toBeDefined();
  });

  // Test 3: getStoreForPrefix('UNKNOWN') throws McpTasksError with code PROJECT_NOT_FOUND
  it('getStoreForPrefix throws PROJECT_NOT_FOUND for unknown prefix', () => {
    const registry = makeRegistry();
    expect(() => registry.getStoreForPrefix('UNKNOWN')).toThrow(McpTasksError);
    try {
      registry.getStoreForPrefix('UNKNOWN');
    } catch (err) {
      expect(err).toBeInstanceOf(McpTasksError);
      expect((err as McpTasksError).code).toBe('PROJECT_NOT_FOUND');
    }
  });

  // Test 4: getStoreForTaskId('LOCAL-001') does not throw
  it('getStoreForTaskId returns a store for a valid task ID', () => {
    const registry = makeRegistry();
    expect(() => registry.getStoreForTaskId('LOCAL-001')).not.toThrow();
  });

  // Test 5: getStoreForTaskId('bad-id') throws McpTasksError with code TASK_NOT_FOUND
  it('getStoreForTaskId throws TASK_NOT_FOUND for an invalid task ID format', () => {
    const registry = makeRegistry();
    expect(() => registry.getStoreForTaskId('bad-id')).toThrow(McpTasksError);
    try {
      registry.getStoreForTaskId('bad-id');
    } catch (err) {
      expect(err).toBeInstanceOf(McpTasksError);
      expect((err as McpTasksError).code).toBe('TASK_NOT_FOUND');
    }
  });

  // Test 6: Global-storage projects share the same TaskStore instance
  it('global-storage projects (MCPAT and NASH) share the same TaskStore instance', () => {
    const registry = makeRegistry();
    const mcpatStore = registry.getStoreForPrefix('MCPAT');
    const nashStore = registry.getStoreForPrefix('NASH');
    expect(mcpatStore).toBe(nashStore);
  });

  // Test 7: allTasksDirs() returns deduplicated dirs
  it('allTasksDirs returns deduplicated list', () => {
    const registry = makeRegistry();
    const dirs = registry.allTasksDirs();
    // LOCAL has local storage (localProjectDir/agent-tasks), MCPAT+NASH share globalStorageDir
    expect(dirs).toHaveLength(2);
    expect(dirs).toContain(path.join(localProjectDir, 'agent-tasks'));
    expect(dirs).toContain(globalStorageDir);
  });

  // Test 8: createTask delegation — verify it calls the inner store's createTask
  it('createTask delegates to the correct inner store', () => {
    const registry = makeRegistry();
    const localStore = registry.getStoreForPrefix('LOCAL');

    // Spy on the inner store's createTask
    const createTaskSpy = vi.spyOn(localStore, 'createTask');

    const input = {
      project: 'LOCAL',
      title: 'Test delegation',
      type: 'feature' as const,
      priority: 'medium' as const,
      why: 'Testing delegation',
    };

    // Create task via registry (will write to tmpDir)
    const localTasksDir = path.join(localProjectDir, 'agent-tasks');
    fs.mkdirSync(localTasksDir, { recursive: true });

    registry.createTask(input);
    expect(createTaskSpy).toHaveBeenCalledWith(input);
  });
});
