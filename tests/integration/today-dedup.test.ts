/**
 * MCPAT-066 — /api/today must not duplicate tasks when multiple global-storage projects share one index db.
 * Regression for the real duplicate-tasks bug: getCandidates/getTasksByScheduledDate were unscoped, so the
 * shared global index was emitted once per global project (EXTR-162 ×4 in the live dashboard).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { MilestoneRepository } from '../../src/store/milestone-repository.js';
import type { Task } from '../../src/types/task.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface TaskShape { id: string }

function seedTask(id: string, project: string, over: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    schema_version: 1, id, title: `Task ${id}`, type: 'feature', status: 'todo', priority: 'high',
    project, tags: [], complexity: 1, complexity_manual: false, why: '', created: now, updated: now,
    last_activity: now, claimed_by: null, claimed_at: null, claim_ttl_hours: 4, parent: null, children: [],
    dependencies: [], subtasks: [], git: { commits: [] }, transitions: [], files: [], body: '',
    file_path: `${id}.md`, scheduled_for: null, ...over,
  };
}

describe('MCPAT-066 — /api/today dedup across shared global index', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-today-'));
    const storageDir = path.join(tempDir, 'global');
    fs.mkdirSync(storageDir, { recursive: true });

    // TWO global-storage projects → both resolve to the SAME global index db (storageDir/.index.db).
    const idx = new SqliteIndex(path.join(storageDir, '.index.db'));
    idx.init();
    idx.ensureProject('GA');
    idx.ensureProject('GB');
    const at = new Date().toISOString();
    // GA-001 carries a transition so it shows up in /api/activity (transitions table).
    idx.upsertTask(seedTask('GA-001', 'GA', { transitions: [{ from: 'todo', to: 'in_progress', at }] }));
    idx.upsertTask(seedTask('GB-002', 'GB'));                                  // unscheduled candidate
    const today = new Date().toISOString().slice(0, 10);
    idx.upsertTask(seedTask('GA-003', 'GA', { scheduled_for: today }));        // committed today
    // A milestone in the shared db → /api/milestones must not multiply it across global projects.
    new MilestoneRepository(idx.getRawDb()).createMilestone({
      id: 'GA-M1', project: 'GA', title: 'Milestone One', status: 'open', created: at,
    });
    idx.close();

    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1, storageDir, defaultStorage: 'global', enforcement: 'off', autoCommit: false,
      claimTtlHours: 4, trackManifest: false, tasksDirName: 'agent-tasks',
      projects: [
        { prefix: 'GA', path: path.join(tempDir, 'ga'), storage: 'global' },
        { prefix: 'GB', path: path.join(tempDir, 'gb'), storage: 'global' },
      ],
    }), 'utf-8');

    saved.MCP_TASKS_CONFIG = process.env['MCP_TASKS_CONFIG'];
    saved.MCP_TASKS_DB = process.env['MCP_TASKS_DB'];
    process.env['MCP_TASKS_CONFIG'] = configPath;
    delete process.env['MCP_TASKS_DB'];

    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('candidates contain each task exactly once (no shared-index duplication)', async () => {
    const r = await (await fetch(`${baseUrl}/api/today`)).json() as { candidates: TaskShape[]; committed: TaskShape[] };
    const count = (arr: TaskShape[], id: string): number => arr.filter(t => t.id === id).length;
    expect(count(r.candidates, 'GA-001')).toBe(1);
    expect(count(r.candidates, 'GB-002')).toBe(1);
    // and no dup ids overall
    const ids = r.candidates.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('committed (scheduled today) contains the task exactly once', async () => {
    const r = await (await fetch(`${baseUrl}/api/today`)).json() as { committed: TaskShape[] };
    expect(r.committed.filter(t => t.id === 'GA-003').length).toBe(1);
  });

  it('/api/milestones does not multiply across shared global indexes (codex F1)', async () => {
    const ms = await (await fetch(`${baseUrl}/api/milestones`)).json() as Array<{ id: string }>;
    expect(ms.filter(m => m.id === 'GA-M1').length).toBe(1);
  });

  it('/api/activity does not multiply across shared global indexes (codex F1)', async () => {
    const act = await (await fetch(`${baseUrl}/api/activity`)).json() as Array<{ task_id: string }>;
    expect(act.filter(a => a.task_id === 'GA-001').length).toBe(1);
  });

  it('/api/tasks stays project-scoped and dup-free (codex F2 — non-regression)', async () => {
    const ga = await (await fetch(`${baseUrl}/api/tasks?project=GA`)).json() as TaskShape[];
    const gaIds = ga.map(t => t.id).sort();
    expect(gaIds).toEqual(['GA-001', 'GA-003']); // only GA, each once
    const gb = await (await fetch(`${baseUrl}/api/tasks?project=GB`)).json() as TaskShape[];
    expect(gb.map(t => t.id)).toEqual(['GB-002']);
  });
});
