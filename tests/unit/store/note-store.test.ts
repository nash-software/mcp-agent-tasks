import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { NoteStore } from '../../../src/store/note-store.js';
import { SqliteIndex } from '../../../src/store/sqlite-index.js';
import { McpTasksError } from '../../../src/types/errors.js';
import type { McpTasksConfig } from '../../../src/config/loader.js';
import { MarkdownStore } from '../../../src/store/markdown-store.js';
import { ManifestWriter } from '../../../src/store/manifest-writer.js';
import { TaskStore } from '../../../src/store/task-store.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-notestore-test-'));
}

function makeConfig(tmpDir: string, projects: McpTasksConfig['projects'] = []): McpTasksConfig {
  return {
    version: 1,
    storageDir: tmpDir,
    defaultStorage: 'global',
    enforcement: 'warn',
    tasksDirName: 'agent-tasks',
    autoCommit: false,
    claimTtlHours: 4,
    trackManifest: true,
    projects,
  };
}

describe('NoteStore', () => {
  let tmpDir: string;
  let idx: SqliteIndex;
  let store: NoteStore;
  let config: McpTasksConfig;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'test.db');
    idx = new SqliteIndex(dbPath);
    idx.init();
    config = makeConfig(tmpDir, [{ prefix: 'TEST', path: tmpDir, storage: 'local' }]);
    store = new NoteStore(idx, config);
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates a note with expected fields and ID scheme', () => {
      const note = store.create({ body: 'Hello world' }, 'TEST');

      expect(note.id).toMatch(/^TEST-N-\d{3}$/);
      expect(note.body).toBe('Hello world');
      expect(note.project).toBe('TEST');
      expect(note.task_id).toBeNull();
      expect(note.tags).toEqual([]);
      expect(note.created_at).toBeTruthy();
      expect(note.updated_at).toBeTruthy();
    });

    it('writes a markdown file to {notesDir}/{id}.md', () => {
      const note = store.create({ body: 'File write test' }, 'TEST');
      const notesDir = store.resolveNotesDir('TEST');
      const filePath = path.join(notesDir, `${note.id}.md`);

      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('File write test');
      expect(content).toContain(note.id);
    });

    it('does NOT leave a .tmp file behind after write', () => {
      const note = store.create({ body: 'Atomic write test' }, 'TEST');
      const notesDir = store.resolveNotesDir('TEST');
      const tmpFile = path.join(notesDir, `${note.id}.md.tmp`);
      expect(fs.existsSync(tmpFile)).toBe(false);
    });

    it('persists note to SQLite index', () => {
      const note = store.create({ body: 'SQLite test' }, 'TEST');
      const fromDb = idx.getNote(note.id);
      expect(fromDb).not.toBeNull();
      expect(fromDb!.body).toBe('SQLite test');
    });

    it('assigns sequential IDs within same project', () => {
      const a = store.create({ body: 'First' }, 'TEST');
      const b = store.create({ body: 'Second' }, 'TEST');
      const numA = parseInt(a.id.split('-N-')[1]!, 10);
      const numB = parseInt(b.id.split('-N-')[1]!, 10);
      expect(numB).toBe(numA + 1);
    });

    it('stores tags in the note record', () => {
      const note = store.create({ body: 'Tagged note', tags: ['alpha', 'beta'] }, 'TEST');
      expect(note.tags).toEqual(['alpha', 'beta']);
      const fromDb = idx.getNote(note.id);
      expect(fromDb!.tags).toEqual(['alpha', 'beta']);
    });

    it('stores task_id when provided and task exists', () => {
      // Create a real task so the foreign key check passes
      const tasksDir = path.join(tmpDir, 'agent-tasks');
      fs.mkdirSync(tasksDir, { recursive: true });
      const taskStore = new TaskStore(new MarkdownStore(), idx, new ManifestWriter(), tasksDir, 'TEST');
      const task = taskStore.createTask({
        project: 'TEST', title: 'A task', type: 'chore', priority: 'medium', why: 'test',
      });

      const note = store.create({ body: 'Linked note', task_id: task.id }, 'TEST');
      expect(note.task_id).toBe(task.id);
    });

    it('throws INVALID_FIELD when body is empty', () => {
      expect(() => store.create({ body: '' }, 'TEST')).toThrow(McpTasksError);
      expect(() => store.create({ body: '' }, 'TEST')).toThrow('empty');
    });

    it('throws INVALID_FIELD when body exceeds 10,000 characters', () => {
      const longBody = 'x'.repeat(10_001);
      expect(() => store.create({ body: longBody }, 'TEST'))
        .toThrow(McpTasksError);
    });

    it('throws TASK_NOT_FOUND when task_id references non-existent task', () => {
      expect(() => store.create({ body: 'Linked', task_id: 'TEST-999' }, 'TEST'))
        .toThrow(McpTasksError);
    });
  });

  // ── get ────────────────────────────────────────────────────────────────────

  describe('get()', () => {
    it('returns the note by ID', () => {
      const created = store.create({ body: 'Get me' }, 'TEST');
      const fetched = store.get(created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.body).toBe('Get me');
    });

    it('throws NOTE_NOT_FOUND for unknown ID', () => {
      let caught: unknown;
      try { store.get('TEST-N-999'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(McpTasksError);
      expect((caught as McpTasksError).code).toBe('NOTE_NOT_FOUND');
    });
  });

  // ── list ───────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns notes sorted by created_at descending', () => {
      const a = store.create({ body: 'First note' }, 'TEST');
      const b = store.create({ body: 'Second note' }, 'TEST');
      const notes = store.list();
      // newest first
      expect(notes[0]!.id).toBe(b.id);
      expect(notes[1]!.id).toBe(a.id);
    });

    it('filters by project', () => {
      const config2 = makeConfig(tmpDir, [
        { prefix: 'PROJ1', path: path.join(tmpDir, 'p1'), storage: 'local' },
        { prefix: 'PROJ2', path: path.join(tmpDir, 'p2'), storage: 'local' },
      ]);
      const store2 = new NoteStore(idx, config2);
      store2.create({ body: 'Note in proj1', project: 'PROJ1' }, 'PROJ1');
      store2.create({ body: 'Note in proj2', project: 'PROJ2' }, 'PROJ2');

      const proj1Notes = store2.list({ project: 'PROJ1' });
      expect(proj1Notes).toHaveLength(1);
      expect(proj1Notes[0]!.body).toBe('Note in proj1');
    });

    it('filters by task_id', () => {
      const tasksDir = path.join(tmpDir, 'agent-tasks');
      fs.mkdirSync(tasksDir, { recursive: true });
      const taskStore = new TaskStore(new MarkdownStore(), idx, new ManifestWriter(), tasksDir, 'TEST');
      const task = taskStore.createTask({
        project: 'TEST', title: 'Task A', type: 'chore', priority: 'medium', why: 'test',
      });

      store.create({ body: 'Linked note', task_id: task.id }, 'TEST');
      store.create({ body: 'Unlinked note' }, 'TEST');

      const linked = store.list({ task_id: task.id });
      expect(linked).toHaveLength(1);
      expect(linked[0]!.body).toBe('Linked note');
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        store.create({ body: `Note ${i}` }, 'TEST');
      }
      const limited = store.list({ limit: 3 });
      expect(limited).toHaveLength(3);
    });
  });

  // ── search ─────────────────────────────────────────────────────────────────

  describe('search()', () => {
    it('finds notes matching body text', () => {
      store.create({ body: 'The quick brown fox' }, 'TEST');
      store.create({ body: 'Another note here' }, 'TEST');

      const results = store.search('quick');
      expect(results).toHaveLength(1);
      expect(results[0]!.body).toContain('quick');
    });

    it('returns empty array when no matches', () => {
      store.create({ body: 'Nothing to find here' }, 'TEST');
      expect(store.search('xyzzy')).toHaveLength(0);
    });
  });

  // ── linkTask ────────────────────────────────────────────────────────────────

  describe('linkTask()', () => {
    it('updates task_id on the note and re-writes markdown', () => {
      const note = store.create({ body: 'Unlinked' }, 'TEST');

      const tasksDir = path.join(tmpDir, 'agent-tasks');
      fs.mkdirSync(tasksDir, { recursive: true });
      const taskStore = new TaskStore(new MarkdownStore(), idx, new ManifestWriter(), tasksDir, 'TEST');
      const task = taskStore.createTask({
        project: 'TEST', title: 'Target task', type: 'chore', priority: 'medium', why: 'test',
      });

      const updated = store.linkTask(note.id, task.id);
      expect(updated.task_id).toBe(task.id);

      // Verify SQLite row updated
      const fromDb = idx.getNote(note.id);
      expect(fromDb!.task_id).toBe(task.id);

      // Verify markdown file updated
      const notesDir = store.resolveNotesDir('TEST');
      const content = fs.readFileSync(path.join(notesDir, `${note.id}.md`), 'utf-8');
      expect(content).toContain(task.id);
    });

    it('throws NOTE_NOT_FOUND when note does not exist', () => {
      const tasksDir = path.join(tmpDir, 'agent-tasks');
      fs.mkdirSync(tasksDir, { recursive: true });
      const taskStore = new TaskStore(new MarkdownStore(), idx, new ManifestWriter(), tasksDir, 'TEST');
      const task = taskStore.createTask({
        project: 'TEST', title: 'T', type: 'chore', priority: 'medium', why: 'test',
      });
      expect(() => store.linkTask('TEST-N-999', task.id)).toThrow(McpTasksError);
    });

    it('throws TASK_NOT_FOUND when task does not exist', () => {
      const note = store.create({ body: 'Link target' }, 'TEST');
      expect(() => store.linkTask(note.id, 'TEST-999')).toThrow(McpTasksError);
    });
  });
});
