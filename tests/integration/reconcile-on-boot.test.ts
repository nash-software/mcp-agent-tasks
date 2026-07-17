/**
 * MCPAT-065 — the dashboard reconciles each project's index against markdown on boot and prunes orphans,
 * so a diverged index can't surface ghost/duplicate rows. One setup exercises all three behaviours:
 *   AC1 a task present in markdown but missing from the index is re-ingested on boot
 *   AC2 an orphan index row (no markdown) is pruned on boot
 *   AC3 a poison markdown file (invalid priority) does not crash boot; other tasks still serve
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { TaskStore } from '../../src/store/task-store.js';
import { MarkdownStore } from '../../src/store/markdown-store.js';
import { ManifestWriter } from '../../src/store/manifest-writer.js';
import type { Task } from '../../src/types/task.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface TaskShape { id: string }

function orphanTask(id: string): Task {
  const now = new Date().toISOString();
  return {
    schema_version: 1, id, title: 'Orphan ghost row', type: 'chore', status: 'todo', priority: 'low',
    project: 'BOOT', tags: [], complexity: 1, complexity_manual: false, why: '', created: now, updated: now,
    last_activity: now, claimed_by: null, claimed_at: null, claim_ttl_hours: 4, parent: null, children: [],
    dependencies: [], subtasks: [], git: { commits: [] }, transitions: [], files: [], body: '',
    file_path: `${id}.md`,
  };
}

describe('MCPAT-065 — reconcile-on-boot', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-boot-'));
    const projectRoot = path.join(tempDir, 'boot-project');
    const tasksDir = path.join(projectRoot, 'agent-tasks');
    fs.mkdirSync(tasksDir, { recursive: true });

    const bareRoot = path.join(tempDir, 'bare-project');
    const bareTasksDir = path.join(bareRoot, 'agent-tasks');
    fs.mkdirSync(bareTasksDir, { recursive: true });

    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1, storageDir: path.join(tempDir, 'global'), defaultStorage: 'local', enforcement: 'off',
      autoCommit: false, claimTtlHours: 4, trackManifest: false, tasksDirName: 'agent-tasks',
      projects: [
        { prefix: 'BOOT', path: projectRoot, storage: 'local' },
        { prefix: 'BARE', path: bareRoot, storage: 'local' },
      ],
    }), 'utf-8');

    saved.MCP_TASKS_CONFIG = process.env['MCP_TASKS_CONFIG'];
    saved.MCP_TASKS_DB = process.env['MCP_TASKS_DB'];
    process.env['MCP_TASKS_CONFIG'] = configPath;
    delete process.env['MCP_TASKS_DB'];

    // MCPAT-142: resolveServerDbPath always resolves to config.storageDir now, so BOOT and BARE
    // (both storage:'local') share ONE physical db file at storageDir/.index.db — seed both
    // projects' rows into that same shared index instead of two separate per-project db files.
    const { loadConfig, resolveServerDbPath } = await import('../../src/config/loader.js');
    const dbPath = resolveServerDbPath(tasksDir, loadConfig(), 'BOOT');
    const idx = new SqliteIndex(dbPath);
    idx.init();
    idx.ensureProject('BOOT');
    idx.ensureProject('BARE');
    const store = new TaskStore(new MarkdownStore(), idx, new ManifestWriter(), tasksDir, 'BOOT');

    // BOOT-001: a real markdown task. Then DELETE its index row → markdown present, index missing it (AC1).
    const t1 = store.createTask({ project: 'BOOT', title: 'Real task from markdown', type: 'chore', priority: 'medium', why: 'x' });
    // Poison file (AC3): copy t1's markdown to a new id with an invalid priority — no index row.
    const poison = fs.readFileSync(t1.file_path, 'utf-8')
      .replace(/^id:.*$/m, 'id: BOOT-666')
      .replace(/^title:.*$/m, 'title: "Poison file"')
      .replace(/^priority:.*$/m, 'priority: normal');
    fs.writeFileSync(path.join(tasksDir, 'BOOT-666.md'), poison, 'utf-8');

    idx.deleteTask(t1.id);                 // AC1: row gone, markdown remains
    idx.upsertTask(orphanTask('BOOT-999')); // AC2: index row with no markdown

    // BARE project: index-only rows, NO markdown files at all. The has-markdown guard must leave its
    // index untouched (don't nuke an index when there's no markdown to heal from).
    idx.upsertTask({ ...orphanTask('BARE-001'), project: 'BARE', title: 'Index-only, no markdown' });
    idx.close();

    handle = await startUiServer({ port: 0 }); // reconcile-on-boot runs here
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('boots successfully despite a poison markdown file (AC3 — server is up and serving)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks?project=BOOT`);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('re-ingests a markdown task missing from the index (AC1)', async () => {
    const tasks = await (await fetch(`${baseUrl}/api/tasks?project=BOOT`)).json() as TaskShape[];
    expect(tasks.some(t => t.id === 'BOOT-001')).toBe(true);
  });

  it('prunes an orphan index row with no markdown (AC2)', async () => {
    const tasks = await (await fetch(`${baseUrl}/api/tasks?project=BOOT`)).json() as TaskShape[];
    expect(tasks.some(t => t.id === 'BOOT-999')).toBe(false);
  });

  it('does not index the poison file (AC3 — skipped, not served)', async () => {
    const tasks = await (await fetch(`${baseUrl}/api/tasks?project=BOOT`)).json() as TaskShape[];
    expect(tasks.some(t => t.id === 'BOOT-666')).toBe(false);
  });

  it('preserves an index-only project with no markdown (has-markdown guard)', async () => {
    // BARE has index rows but zero markdown — the guard must NOT prune it to empty on boot.
    const tasks = await (await fetch(`${baseUrl}/api/tasks?project=BARE`)).json() as TaskShape[];
    expect(tasks.some(t => t.id === 'BARE-001')).toBe(true);
  });
});
