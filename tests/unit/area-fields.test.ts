/**
 * Unit tests for:
 * - schema/task.schema.json: area + scheduled_for field definitions
 * - schema/config.schema.json: areas map definition
 * - MarkdownStore: frontmatter round-trip for area + scheduled_for
 * - SqliteIndex: read/write of area + scheduled_for columns
 * - resolveArea helper: all three precedence cases
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { MarkdownStore } from '../../src/store/markdown-store.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { TaskFactory } from '../../src/store/task-factory.js';
import { resolveArea } from '../../src/store/area.js';
import type { Task } from '../../src/types/task.js';

const require = createRequire(import.meta.url);
const taskSchema = require('../../schema/task.schema.json') as {
  properties: Record<string, { type?: string | string[]; enum?: string[] }>;
};
const configSchema = require('../../schema/config.schema.json') as {
  properties: Record<string, {
    type?: string;
    additionalProperties?: { type?: string; enum?: string[] };
    description?: string;
  }>;
};

// ─── Schema JSON tests ───────────────────────────────────────────────────────

describe('task.schema.json — area + scheduled_for', () => {
  it('defines area as an optional string enum with four values', () => {
    const area = taskSchema.properties['area'];
    expect(area).toBeDefined();
    expect(area?.type).toBe('string');
    expect(area?.enum).toEqual(['client', 'personal', 'outsource', 'internal']);
  });

  it('defines scheduled_for as optional string-or-null', () => {
    const sf = taskSchema.properties['scheduled_for'];
    expect(sf).toBeDefined();
    expect(sf?.type).toContain('string');
    expect(sf?.type).toContain('null');
  });
});

describe('config.schema.json — areas map', () => {
  it('defines areas as an optional object with Area-valued additionalProperties', () => {
    const areas = configSchema.properties['areas'];
    expect(areas).toBeDefined();
    expect(areas?.type).toBe('object');
    expect(areas?.additionalProperties?.type).toBe('string');
    expect(areas?.additionalProperties?.enum).toEqual(['client', 'personal', 'outsource', 'internal']);
  });
});

// ─── resolveArea helper tests ─────────────────────────────────────────────────

describe('resolveArea — precedence', () => {
  it('returns the explicit task area when set', () => {
    expect(resolveArea('client', 'MYPROJ', { areas: { MYPROJ: 'personal' } })).toBe('client');
  });

  it('falls back to config areas[project] when task area is absent', () => {
    expect(resolveArea(undefined, 'MYPROJ', { areas: { MYPROJ: 'personal' } })).toBe('personal');
  });

  it('falls back to "internal" when neither task area nor config mapping is set', () => {
    expect(resolveArea(undefined, 'MYPROJ', {})).toBe('internal');
  });

  it('falls back to "internal" when config areas map exists but project is not in it', () => {
    expect(resolveArea(undefined, 'OTHER', { areas: { MYPROJ: 'client' } })).toBe('internal');
  });
});

// ─── MarkdownStore round-trip tests ──────────────────────────────────────────

function makeMinimalTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    id: 'TEST-001',
    title: 'Test task',
    type: 'feature',
    status: 'todo',
    priority: 'medium',
    project: 'TEST',
    tags: [],
    complexity: 1,
    complexity_manual: false,
    why: 'testing',
    created: now,
    updated: now,
    last_activity: now,
    claimed_by: null,
    claimed_at: null,
    claim_ttl_hours: 4,
    parent: null,
    children: [],
    dependencies: [],
    subtasks: [],
    git: { commits: [] },
    transitions: [],
    files: [],
    body: 'body text',
    file_path: '',
    ...overrides,
  };
}

describe('MarkdownStore — area + scheduled_for frontmatter round-trip', () => {
  let tmpDir: string;
  let store: MarkdownStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-area-md-test-'));
    store = new MarkdownStore();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads back area when set', () => {
    const filePath = path.join(tmpDir, 'TEST-001.md');
    const task = makeMinimalTask({ file_path: filePath, area: 'client' });
    store.write(task);

    const read = store.read(filePath);
    expect(read.area).toBe('client');
  });

  it('omits area from frontmatter when absent', () => {
    const filePath = path.join(tmpDir, 'TEST-001.md');
    const task = makeMinimalTask({ file_path: filePath });
    store.write(task);

    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw).not.toContain('area:');

    const read = store.read(filePath);
    expect(read.area).toBeUndefined();
  });

  it('writes and reads back scheduled_for when set to a date string', () => {
    const filePath = path.join(tmpDir, 'TEST-001.md');
    const task = makeMinimalTask({ file_path: filePath, scheduled_for: '2026-06-01' });
    store.write(task);

    const read = store.read(filePath);
    expect(read.scheduled_for).toBe('2026-06-01');
  });

  it('omits scheduled_for from frontmatter when null', () => {
    const filePath = path.join(tmpDir, 'TEST-001.md');
    const task = makeMinimalTask({ file_path: filePath, scheduled_for: null });
    store.write(task);

    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw).not.toContain('scheduled_for:');

    const read = store.read(filePath);
    expect(read.scheduled_for).toBeUndefined();
  });

  it('omits scheduled_for from frontmatter when undefined', () => {
    const filePath = path.join(tmpDir, 'TEST-001.md');
    const task = makeMinimalTask({ file_path: filePath });
    store.write(task);

    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw).not.toContain('scheduled_for:');
  });

  it('loads existing task files without area/scheduled_for fields without error (backward compat)', () => {
    const filePath = path.join(tmpDir, 'TEST-001.md');
    // Write a minimal task without new fields
    const task = makeMinimalTask({ file_path: filePath });
    store.write(task);

    // Verify the file can be read back cleanly
    expect(() => store.read(filePath)).not.toThrow();
    const read = store.read(filePath);
    expect(read.area).toBeUndefined();
    expect(read.scheduled_for).toBeUndefined();
  });
});

// ─── SqliteIndex column read/write tests ─────────────────────────────────────

describe('SqliteIndex — area + scheduled_for columns', () => {
  let tmpDir: string;
  let idx: SqliteIndex;
  let factory: TaskFactory;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-area-db-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    idx = new SqliteIndex(dbPath);
    idx.init();
    idx.ensureProject('TEST');
    factory = new TaskFactory();
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeTask(overrides: Partial<Task> = {}): Task {
    const t = factory.create(
      { project: 'TEST', title: 'Test', type: 'feature', priority: 'medium', why: 'y' },
      'TEST-001',
      tmpDir,
    );
    return { ...t, ...overrides };
  }

  it('stores and retrieves area column', () => {
    const task = makeTask({ area: 'personal' });
    idx.upsertTask(task);

    const retrieved = idx.getTask('TEST-001');
    expect(retrieved?.area).toBe('personal');
  });

  it('stores and retrieves scheduled_for column', () => {
    const task = makeTask({ scheduled_for: '2026-07-15' });
    idx.upsertTask(task);

    const retrieved = idx.getTask('TEST-001');
    expect(retrieved?.scheduled_for).toBe('2026-07-15');
  });

  it('stores null area as absent on retrieval', () => {
    const task = makeTask();
    idx.upsertTask(task);

    const retrieved = idx.getTask('TEST-001');
    expect(retrieved?.area).toBeUndefined();
  });

  it('stores undefined scheduled_for as absent on retrieval', () => {
    const task = makeTask();
    idx.upsertTask(task);

    const retrieved = idx.getTask('TEST-001');
    expect(retrieved?.scheduled_for).toBeUndefined();
  });

  it('migration: addColumnIfNotExists is idempotent — calling init() twice does not throw', () => {
    expect(() => idx.init()).not.toThrow();
  });
});

// ─── TaskFactory defaults ─────────────────────────────────────────────────────

describe('TaskFactory — scheduled_for default', () => {
  it('sets scheduled_for to null on newly created tasks', () => {
    const factory = new TaskFactory();
    const task = factory.create(
      { project: 'TEST', title: 'New', type: 'feature', priority: 'medium', why: 'y' },
      'TEST-001',
      '/tmp/tasks',
    );
    expect(task.scheduled_for).toBeNull();
  });

  it('does not set area on newly created tasks (resolves via helper)', () => {
    const factory = new TaskFactory();
    const task = factory.create(
      { project: 'TEST', title: 'New', type: 'feature', priority: 'medium', why: 'y' },
      'TEST-001',
      '/tmp/tasks',
    );
    expect(task.area).toBeUndefined();
  });
});
