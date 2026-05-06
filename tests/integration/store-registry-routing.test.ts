/**
 * Integration test: StoreRegistry routes createTask to the correct project directory.
 * Verifies that two projects with different paths each get their task files written
 * to their own directory, not to the first project's directory.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StoreRegistry } from '../../src/store/store-registry.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { MarkdownStore } from '../../src/store/markdown-store.js';
import { ManifestWriter } from '../../src/store/manifest-writer.js';
import type { McpTasksConfig } from '../../src/config/loader.js';

// Temp directories created once for all tests in this file
const tmpDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpat-reg-A-'));
const tmpDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpat-reg-B-'));
const tmpDirDb = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpat-reg-db-'));

// Create subdirs needed for TaskStore (it writes directly to tasksDir)
// Using tasksDirName='.' so the store writes into tmpDirA / tmpDirB directly
fs.mkdirSync(path.join(tmpDirA, 'archive'), { recursive: true });
fs.mkdirSync(path.join(tmpDirB, 'archive'), { recursive: true });

function makeConfig(dirA: string, dirB: string): McpTasksConfig {
  return {
    version: 1,
    storageDir: dirB, // not used by local projects, but required by the type
    defaultStorage: 'local',
    enforcement: 'warn',
    autoCommit: false,
    claimTtlHours: 4,
    trackManifest: false,
    tasksDirName: '.', // tasks go directly into the project path (no subdir)
    projects: [
      { prefix: 'PROJ', path: dirA, storage: 'local' },
      { prefix: 'GLOB', path: dirB, storage: 'local' },
    ],
  };
}

afterAll(() => {
  // Cleanup temp dirs
  fs.rmSync(tmpDirA, { recursive: true, force: true });
  fs.rmSync(tmpDirB, { recursive: true, force: true });
  fs.rmSync(tmpDirDb, { recursive: true, force: true });
});

describe('StoreRegistry routing', () => {
  it('routes createTask for PROJ to tmpDirA and GLOB to tmpDirB', () => {
    const dbPath = path.join(tmpDirDb, 'test.db');
    const idx = new SqliteIndex(dbPath);
    idx.init();

    const markdownStore = new MarkdownStore();
    const manifestWriter = new ManifestWriter();
    const config = makeConfig(tmpDirA, tmpDirB);
    const registry = new StoreRegistry(config, idx, markdownStore, manifestWriter);

    // Create a task for PROJ — should land in tmpDirA
    const taskA = registry.createTask({
      project: 'PROJ',
      title: 'test task A',
      type: 'chore',
      priority: 'low',
      why: 'test routing',
    });

    expect(taskA.file_path).toBeTruthy();
    expect(taskA.file_path.startsWith(tmpDirA)).toBe(true);
    expect(fs.existsSync(taskA.file_path)).toBe(true);

    // Create a task for GLOB — should land in tmpDirB
    const taskB = registry.createTask({
      project: 'GLOB',
      title: 'test task B',
      type: 'chore',
      priority: 'low',
      why: 'test routing',
    });

    expect(taskB.file_path).toBeTruthy();
    expect(taskB.file_path.startsWith(tmpDirB)).toBe(true);
    expect(fs.existsSync(taskB.file_path)).toBe(true);

    // Confirm PROJ task did NOT land in tmpDirB, and GLOB task did NOT land in tmpDirA
    expect(taskA.file_path.startsWith(tmpDirB)).toBe(false);
    expect(taskB.file_path.startsWith(tmpDirA)).toBe(false);

    idx.close();
  });
});
