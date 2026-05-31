/**
 * P5-10 (MCPAT-060) — ID-collision integrity:
 *  - nextId is authoritative (index + disk + watermark), never reuses an id (AC1, AC2)
 *  - createTask refuses an (id, project) collision (AC3)
 *  - Reconciler warns on colliding files (AC4)
 *  - the re-ID migration repairs collisions losslessly + idempotently (AC5)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskStore } from '../../src/store/task-store.js';
import { MarkdownStore } from '../../src/store/markdown-store.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { ManifestWriter } from '../../src/store/manifest-writer.js';
import { Reconciler } from '../../src/store/reconciler.js';
import { McpTasksError } from '../../src/types/errors.js';
import { planCollisionFixes, applyCollisionFixes, findReferences, type StoreRef } from '../../src/store/id-collision-fixer.js';

function md(id: string, title: string, status = 'todo', body = ''): string {
  return `---\nschema_version: 1\nid: ${id}\ntitle: "${title}"\nstatus: ${status}\ntype: feature\npriority: medium\nproject: ${id.split('-')[0]}\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n${body}`;
}

describe('P5-10 — ID-collision integrity', () => {
  let tmpDir: string;
  let tasksDir: string;
  let idx: SqliteIndex;
  let store: TaskStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-idcoll-'));
    tasksDir = path.join(tmpDir, 'tasks');
    fs.mkdirSync(path.join(tasksDir, 'archive'), { recursive: true });
    idx = new SqliteIndex(path.join(tmpDir, 'tasks.db'));
    idx.init();
    store = new TaskStore(new MarkdownStore(), idx, new ManifestWriter(), tasksDir, 'TEST');
  });

  afterEach(() => {
    try { idx.close(); } catch { /* already closed */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC1 — nextId never reuses an id even without tasksDir, against a stale low watermark
  it('AC1: nextId without tasksDir skips past the index max (stale watermark)', () => {
    const t = store.createTask({ project: 'TEST', title: 'seed', type: 'feature', priority: 'medium', why: 'y' });
    idx.upsertTask({ ...t, id: 'TEST-011' });
    // simulate a stale/low watermark left by an index rebuild
    idx.getRawDb().prepare("UPDATE projects SET next_id = 1 WHERE prefix = 'TEST'").run();
    const n = idx.nextId('TEST'); // no tasksDir passed
    expect(n).toBeGreaterThanOrEqual(12);
  });

  // AC2 — disk max is honoured when tasksDir is available
  it('AC2: nextId honours the on-disk max', () => {
    fs.writeFileSync(path.join(tasksDir, 'TEST-050.md'), md('TEST-050', 'on disk'));
    const n = idx.nextId('TEST', tasksDir);
    expect(n).toBeGreaterThanOrEqual(51);
  });

  // AC3 — createTask refuses an (id, project) collision (backstop guard)
  it('AC3: createTask throws ID_CONFLICT when the id already exists', () => {
    const t = store.createTask({ project: 'TEST', title: 'first', type: 'feature', priority: 'medium', why: 'y' });
    // Force the next allocation to collide by rewinding the watermark below an existing id.
    idx.getRawDb().prepare("UPDATE projects SET next_id = ? WHERE prefix = 'TEST'").run(parseInt(t.id.split('-')[1], 10) - 1);
    // With the authoritative nextId this should still skip the existing id; assert no collision is created.
    const t2 = store.createTask({ project: 'TEST', title: 'second', type: 'feature', priority: 'medium', why: 'y' });
    expect(t2.id).not.toBe(t.id);
    // Direct guard: attempting to create an object whose id is already taken must throw.
    expect(() => {
      // simulate a bypass path by pre-seeding the watermark to re-mint t2.id
      idx.getRawDb().prepare("UPDATE projects SET next_id = ? WHERE prefix = 'TEST'").run(parseInt(t2.id.split('-')[1], 10) - 1);
      // monkeypatch nextId to force the collision the guard must catch
      const spy = vi.spyOn(idx, 'nextId').mockReturnValue(parseInt(t2.id.split('-')[1], 10));
      try { store.createTask({ project: 'TEST', title: 'dup', type: 'feature', priority: 'medium', why: 'y' }); }
      finally { spy.mockRestore(); }
    }).toThrow(McpTasksError);
  });

  // AC4 — Reconciler warns on colliding files
  it('AC4: Reconciler records a collision when two files share an id', () => {
    fs.writeFileSync(path.join(tasksDir, 'TEST-001-real.md'), md('TEST-001', 'Real task', 'in_progress', 'body here'));
    fs.writeFileSync(path.join(tasksDir, 'TEST-001.md'), md('TEST-001', 'Masked task', 'todo'));
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reconciler = new Reconciler(idx, tasksDir, 'TEST');
    reconciler.reconcile();
    warn.mockRestore();
    const collisions = reconciler.getCollisions();
    expect(collisions).toHaveLength(1);
    expect(collisions[0].id).toBe('TEST-001');
    expect(collisions[0].files).toHaveLength(2);
  });

  // AC5 — migration repairs collisions losslessly + idempotently
  it('AC5: planCollisionFixes + applyCollisionFixes preserves both tasks with unique ids', () => {
    fs.writeFileSync(path.join(tasksDir, 'TEST-001-real-plan.md'), md('TEST-001', 'Real plan', 'in_progress', 'lots of body'));
    fs.writeFileSync(path.join(tasksDir, 'TEST-001.md'), md('TEST-001', 'Masked task', 'todo'));
    const stores: StoreRef[] = [{ prefix: 'TEST', tasksDir }];

    const plans = planCollisionFixes(stores);
    expect(plans).toHaveLength(1);
    expect(plans[0].canonical.file).toBe('TEST-001-real-plan.md'); // slug file kept
    expect(plans[0].reassign).toHaveLength(1);
    expect(plans[0].reassign[0].file).toBe('TEST-001.md');
    const newId = plans[0].reassign[0].newId;
    expect(newId).not.toBe('TEST-001');

    const { reassigned } = applyCollisionFixes(plans);
    expect(reassigned).toBe(1);

    // canonical untouched, masked task re-IDed to a new file, both present, no data lost
    expect(fs.existsSync(path.join(tasksDir, 'TEST-001-real-plan.md'))).toBe(true);
    expect(fs.existsSync(path.join(tasksDir, 'TEST-001.md'))).toBe(false);
    expect(fs.existsSync(path.join(tasksDir, `${newId}.md`))).toBe(true);
    expect(fs.readFileSync(path.join(tasksDir, `${newId}.md`), 'utf-8')).toContain(`id: ${newId}`);
    expect(fs.readFileSync(path.join(tasksDir, `${newId}.md`), 'utf-8')).toContain('Masked task');

    // idempotent: re-planning finds nothing
    expect(planCollisionFixes(stores)).toHaveLength(0);
  });

  // AC4 (refinement) — identical-content duplicates are NOT flagged as collisions (codex F3)
  it('AC4: identical-content files with the same id are not flagged', () => {
    const same = md('TEST-007', 'Same', 'todo', 'identical body');
    fs.writeFileSync(path.join(tasksDir, 'TEST-007.md'), same);
    fs.writeFileSync(path.join(tasksDir, 'TEST-007-copy.md'), same);
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reconciler = new Reconciler(idx, tasksDir, 'TEST');
    reconciler.reconcile();
    warn.mockRestore();
    expect(reconciler.getCollisions()).toHaveLength(0);
  });

  // codex F4 — references to a moving id are surfaced so apply can be gated
  it('findReferences reports files that mention a re-IDed task elsewhere', () => {
    fs.writeFileSync(path.join(tasksDir, 'TEST-001-real.md'), md('TEST-001', 'Real', 'in_progress', 'body'));
    fs.writeFileSync(path.join(tasksDir, 'TEST-001.md'), md('TEST-001', 'Masked', 'todo'));
    // Another task whose body references TEST-001
    fs.writeFileSync(path.join(tasksDir, 'TEST-050.md'), md('TEST-050', 'Refers', 'todo', 'blocked by TEST-001 here'));
    const stores: StoreRef[] = [{ prefix: 'TEST', tasksDir }];
    const refs = findReferences(stores, ['TEST-001']);
    expect(refs.some(r => r.file === 'TEST-050.md')).toBe(true);
    // the colliding files' own `id:` lines do not count as external references
    expect(refs.some(r => r.file === 'TEST-001.md')).toBe(false);
  });
});
