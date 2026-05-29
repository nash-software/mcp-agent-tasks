/**
 * P2-04 — agent_status (+ block_reason) field round-trip tests.
 *
 * Verifies the Hermes sign-off marker threads correctly through all store layers:
 *  - MarkdownStore: present round-trips identical; absent stays absent (not null/'').
 *  - SqliteIndex: upsert + getTask round-trips agent_status and block_reason.
 *  - SqliteIndex CHECK constraint rejects a bad agent_status value (AC-8 runtime guard).
 *  - schema/task.schema.json declares the agent_status enum and block_reason (AC-8 schema).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { MarkdownStore } from '../../src/store/markdown-store.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import type { Task } from '../../src/types/task.js';

const require = createRequire(import.meta.url);

function now(): string {
  return new Date().toISOString();
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const ts = now();
  return {
    schema_version: 1,
    id: 'TEST-001',
    title: 'Test task',
    type: 'feature',
    status: 'todo',
    priority: 'medium',
    project: 'TEST',
    tags: [],
    complexity: 3,
    complexity_manual: false,
    why: 'because',
    created: ts,
    updated: ts,
    last_activity: ts,
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
    body: 'body',
    file_path: '',
    ...overrides,
  };
}

describe('agent_status — MarkdownStore round-trip', () => {
  let store: MarkdownStore;
  let tmpDir: string;

  beforeEach(() => {
    store = new MarkdownStore();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-status-md-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads back agent_status: scheduled identically', () => {
    const file = path.join(tmpDir, 'TEST-001.md');
    const task = makeTask({ file_path: file, agent_status: 'scheduled', block_reason: 'waiting on X' });
    store.write(task);
    const read = store.read(file);
    expect(read.agent_status).toBe('scheduled');
    expect(read.block_reason).toBe('waiting on X');
  });

  it('omits agent_status from frontmatter when absent (not null, not empty string)', () => {
    const file = path.join(tmpDir, 'TEST-002.md');
    const task = makeTask({ id: 'TEST-002', file_path: file });
    store.write(task);
    const raw = fs.readFileSync(file, 'utf-8');
    expect(raw).not.toMatch(/agent_status/);
    expect(raw).not.toMatch(/block_reason/);
    const read = store.read(file);
    expect('agent_status' in read).toBe(false);
    expect('block_reason' in read).toBe(false);
  });
});

describe('agent_status — SqliteIndex round-trip', () => {
  let tmpDir: string;
  let idx: SqliteIndex;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-status-db-'));
    idx = new SqliteIndex(path.join(tmpDir, 'test.db'));
    idx.init();
    idx.ensureProject('TEST');
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips agent_status and block_reason through upsert + getTask', () => {
    idx.upsertTask(makeTask({ agent_status: 'running', block_reason: 'blocked yo' }));
    const got = idx.getTask('TEST-001');
    expect(got?.agent_status).toBe('running');
    expect(got?.block_reason).toBe('blocked yo');
  });

  it('leaves agent_status absent when not set', () => {
    idx.upsertTask(makeTask({ id: 'TEST-002' }));
    const got = idx.getTask('TEST-002');
    expect(got).toBeDefined();
    expect('agent_status' in (got as Task)).toBe(false);
    expect('block_reason' in (got as Task)).toBe(false);
  });

  it('rejects a bad agent_status value via the CHECK constraint (AC-8 runtime)', () => {
    // Cast through unknown to bypass the compile-time union and exercise the DB guard.
    const bad = makeTask({ id: 'TEST-003' }) as unknown as Task & { agent_status: string };
    bad.agent_status = 'bogus';
    expect(() => idx.upsertTask(bad as Task)).toThrow();
  });
});

describe('task.schema.json — agent_status + block_reason definitions (AC-8)', () => {
  const schema = require('../../schema/task.schema.json') as {
    properties: Record<string, { type?: string | string[]; enum?: unknown[] }>;
  };

  it('declares agent_status with the scheduled/running/done enum', () => {
    const prop = schema.properties['agent_status'];
    expect(prop).toBeDefined();
    expect(prop?.enum).toContain('scheduled');
    expect(prop?.enum).toContain('running');
    expect(prop?.enum).toContain('done');
    expect(prop?.enum).not.toContain('bogus');
  });

  it('declares block_reason as an optional string|null', () => {
    const prop = schema.properties['block_reason'];
    expect(prop).toBeDefined();
    expect(prop?.type).toEqual(['string', 'null']);
  });
});
