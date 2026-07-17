/**
 * MCPAT-147 — cross-store TOCTOU collision regression (MCPAT-111).
 *
 * The MCPAT-111 investigation found that the always-on MCP server
 * (src/server.ts) and CLI-spawned processes (src/cli.ts buildStore(), via
 * resolveServerDbPath()) could open two DIFFERENT physical SQLite index
 * files for the SAME project when that project's config entry had
 * `storage: 'local'`: server.ts always opens the shared global .index.db,
 * while resolveServerDbPath() (pre-fix) branched on `storage` and returned
 * a separate `<repo>/agent-tasks/.index.db` file.
 *
 * nextId()'s directory-rescan safeguard is eventually-consistent, not
 * atomic: if two independent SqliteIndex instances (each with its own
 * `next_id` counter) call nextId() for the same prefix before either has
 * written a markdown file to the shared tasksDir, both scans see an empty
 * directory and both counters independently start from 0 — minting the
 * same ID. This is only possible because the two "processes" disagree on
 * which physical db file to open; once both resolve to the same file, the
 * single SQLite connection's counter serializes the two calls and the
 * second one always advances.
 *
 * These tests exercise the real resolveServerDbPath() from
 * src/config/loader.ts (unlike the unit test in tests/unit/config-loader.test.ts,
 * which only asserts path-string equality) by actually constructing two
 * independent SqliteIndex instances from the resolved paths and allocating
 * task IDs through them, proving the collision is structurally impossible
 * post-fix.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveServerDbPath, getDbPath } from '../../src/config/loader.js';
import type { McpTasksConfig } from '../../src/config/loader.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';

function makeConfig(storageDir: string, projectPath: string): McpTasksConfig {
  return {
    version: 1,
    storageDir,
    defaultStorage: 'global',
    enforcement: 'warn',
    autoCommit: false,
    claimTtlHours: 4,
    trackManifest: true,
    tasksDirName: 'agent-tasks',
    projects: [{ prefix: 'TCOL', path: projectPath, storage: 'local' }],
  };
}

/** Reimplements the pre-MCPAT-111 branching resolver so the "bug still exists" case
 *  can be demonstrated without needing to revert source (used only to document the
 *  collision shape; the real regression assertions below exercise the actual,
 *  currently-shipped resolveServerDbPath()). */
function legacyResolveServerDbPath(tasksDir: string, config: McpTasksConfig, projectPrefix?: string): string {
  const project = projectPrefix ? config.projects.find(p => p.prefix === projectPrefix) : config.projects[0];
  if (project?.storage === 'global') return getDbPath(config);
  if (!project) return getDbPath(config);
  return path.join(tasksDir, '.index.db');
}

describe('MCPAT-147 — cross-store TOCTOU collision regression', () => {
  let tmpRoot: string;
  let globalStorageDir: string;
  let projectPath: string;
  let tasksDir: string;
  let config: McpTasksConfig;
  const openIndexes: SqliteIndex[] = [];

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpat-147-'));
    globalStorageDir = path.join(tmpRoot, 'global-storage');
    projectPath = path.join(tmpRoot, 'project-repo');
    tasksDir = path.join(projectPath, 'agent-tasks');
    fs.mkdirSync(globalStorageDir, { recursive: true });
    fs.mkdirSync(tasksDir, { recursive: true });
    config = makeConfig(globalStorageDir, projectPath);
  });

  afterEach(() => {
    for (const idx of openIndexes.splice(0)) {
      try { idx.close(); } catch { /* already closed */ }
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function openIndex(dbPath: string): SqliteIndex {
    const idx = new SqliteIndex(dbPath);
    idx.init();
    openIndexes.push(idx);
    return idx;
  }

  it('documents the pre-fix bug shape: two processes resolving different db files mint colliding IDs', () => {
    // server.ts always opens the shared global db, regardless of storage.
    const serverDbPath = getDbPath(config);
    // pre-MCPAT-111 cli.ts (via the old branching resolveServerDbPath) opened a
    // SEPARATE db file for a storage:'local' project.
    const cliDbPath = legacyResolveServerDbPath(tasksDir, config, 'TCOL');
    expect(cliDbPath).not.toBe(serverDbPath);

    const serverIndex = openIndex(serverDbPath);
    const cliIndex = openIndex(cliDbPath);

    // Both "processes" race to allocate an ID for the same prefix before either
    // has written a markdown file into the shared tasksDir (the actual TOCTOU
    // window: nextId()'s directory rescan sees an empty dir on both sides).
    const idFromServer = serverIndex.nextId('TCOL', tasksDir);
    const idFromCli = cliIndex.nextId('TCOL', tasksDir);

    expect(idFromServer).toBe(1);
    expect(idFromCli).toBe(1); // COLLISION — both minted TCOL-001
  });

  it('MCPAT-111 fix: resolveServerDbPath resolves the same db file for a local-storage project as the server, closing the race', () => {
    const serverDbPath = getDbPath(config);
    const cliDbPath = resolveServerDbPath(tasksDir, config, 'TCOL');

    // Structural precondition for the race being closed: both call sites now
    // agree on the same physical file.
    expect(cliDbPath).toBe(serverDbPath);

    const serverIndex = openIndex(serverDbPath);
    const cliIndex = openIndex(cliDbPath);

    // Same race shape as above — both allocate before either writes a markdown
    // file — but this time through the SAME db file, so SQLite serializes the
    // two next_id updates and the second call always advances.
    const idFromServer = serverIndex.nextId('TCOL', tasksDir);
    const idFromCli = cliIndex.nextId('TCOL', tasksDir);

    expect(idFromServer).toBe(1);
    expect(idFromCli).toBe(2); // no collision
    expect(idFromServer).not.toBe(idFromCli);
  });

  it('MCPAT-111 fix: holds for a global-storage project too (no divergence introduced for the already-correct case)', () => {
    const globalConfig: McpTasksConfig = {
      ...config,
      projects: [{ prefix: 'TCOL', path: projectPath, storage: 'global' }],
    };
    const serverDbPath = getDbPath(globalConfig);
    const cliDbPath = resolveServerDbPath(tasksDir, globalConfig, 'TCOL');
    expect(cliDbPath).toBe(serverDbPath);

    const serverIndex = openIndex(serverDbPath);
    const cliIndex = openIndex(cliDbPath);

    const idFromServer = serverIndex.nextId('TCOL', tasksDir);
    const idFromCli = cliIndex.nextId('TCOL', tasksDir);

    expect(idFromServer).toBe(1);
    expect(idFromCli).toBe(2);
  });
});
