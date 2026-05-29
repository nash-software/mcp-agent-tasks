/**
 * P2-04b — draft auto-triage tests.
 *
 * Covers the testable core without spawning the Haiku CLI:
 *  - getDraftTriageThreshold: default 0.8, env override, clamp to [0,1]
 *  - parseTriageResponse: valid JSON, embedded JSON, malformed → null
 *  - applyTriageResult: auto-promote branch, flag branch, malformed → fallback
 *  - triage_note / triage_confidence round-trip through markdown → reconcile (rebuild survival)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {
  getDraftTriageThreshold,
  parseTriageResponse,
  applyTriageResult,
} from '../../src/server-ui.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { MarkdownStore } from '../../src/store/markdown-store.js';
import { Reconciler } from '../../src/store/reconciler.js';
import type { Task } from '../../src/types/task.js';

function makeDraft(id: string, tasksDir: string): Task {
  const now = new Date().toISOString();
  return {
    schema_version: 1, id, title: 'Investigate flaky deploy', type: 'plan',
    status: 'draft', priority: 'medium', project: 'TST', tags: [], complexity: 1,
    complexity_manual: false, why: '', created: now, updated: now, last_activity: now,
    claimed_by: null, claimed_at: null, claim_ttl_hours: 4, parent: null,
    children: [], dependencies: [], subtasks: [], git: { commits: [] },
    transitions: [], files: [], body: 'draft body', file_path: path.join(tasksDir, `${id}.md`),
  } as Task;
}

describe('getDraftTriageThreshold', () => {
  let saved: string | undefined;
  beforeEach(() => { saved = process.env['DRAFT_TRIAGE_THRESHOLD']; });
  afterEach(() => {
    if (saved === undefined) delete process.env['DRAFT_TRIAGE_THRESHOLD'];
    else process.env['DRAFT_TRIAGE_THRESHOLD'] = saved;
  });

  it('defaults to 0.8 when unset', () => {
    delete process.env['DRAFT_TRIAGE_THRESHOLD'];
    expect(getDraftTriageThreshold()).toBe(0.8);
  });
  it('reads the env override', () => {
    process.env['DRAFT_TRIAGE_THRESHOLD'] = '0.5';
    expect(getDraftTriageThreshold()).toBe(0.5);
  });
  it('clamps out-of-range and falls back on garbage', () => {
    process.env['DRAFT_TRIAGE_THRESHOLD'] = '5';
    expect(getDraftTriageThreshold()).toBeLessThanOrEqual(1);
    process.env['DRAFT_TRIAGE_THRESHOLD'] = '-1';
    expect(getDraftTriageThreshold()).toBeGreaterThanOrEqual(0);
    process.env['DRAFT_TRIAGE_THRESHOLD'] = 'notanumber';
    expect(getDraftTriageThreshold()).toBe(0.8);
  });
});

describe('parseTriageResponse', () => {
  it('parses a clean JSON object', () => {
    const r = parseTriageResponse('{"project":"TST","priority":"high","area":"client","confidence":0.9,"needs_human":false}');
    expect(r?.project).toBe('TST');
    expect(r?.confidence).toBe(0.9);
  });
  it('extracts JSON embedded in chatter', () => {
    const r = parseTriageResponse('Here is the result:\n{"project":"GEN","priority":"low","area":"personal","confidence":0.4,"needs_human":true}\nDone.');
    expect(r?.needs_human).toBe(true);
  });
  it('returns null on malformed output', () => {
    expect(parseTriageResponse('not json at all')).toBeNull();
    expect(parseTriageResponse('')).toBeNull();
  });
});

describe('applyTriageResult', () => {
  let tempDir: string;
  let tasksDir: string;
  let dbPath: string;
  let projectIndexes: Array<{ prefix: string; index: SqliteIndex; tasksDir: string }>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-'));
    tasksDir = path.join(tempDir, 'agent-tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    dbPath = path.join(tasksDir, '.index.db');
    const idx = new SqliteIndex(dbPath);
    idx.init();
    idx.ensureProject('TST');
    // Seed a draft both in markdown (for write-through) and SQLite.
    const draft = makeDraft('TST-001', tasksDir);
    new MarkdownStore().write(draft);
    idx.upsertTask({ ...draft, file_path: 'TST-001.md' });
    projectIndexes = [{ prefix: 'TST', index: idx, tasksDir }];
  });
  afterEach(() => {
    projectIndexes[0].index.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('auto-promotes a high-confidence, no-human-needed draft to todo', () => {
    const stdout = '{"project":"TST","priority":"high","area":"client","confidence":0.95,"needs_human":false}';
    applyTriageResult('TST-001', stdout, projectIndexes as never, 0.8);
    const t = projectIndexes[0].index.getTask('TST-001');
    expect(t?.status).toBe('todo');
    expect(t?.priority).toBe('high');
    expect(t?.area).toBe('client');
    expect(t?.triage_note).toBeUndefined();
  });

  it('flags a low-confidence draft (stays draft with note + confidence)', () => {
    const stdout = '{"project":"TST","priority":"medium","area":"internal","confidence":0.4,"needs_human":false,"triage_note":"project unclear"}';
    applyTriageResult('TST-001', stdout, projectIndexes as never, 0.8);
    const t = projectIndexes[0].index.getTask('TST-001');
    expect(t?.status).toBe('draft');
    expect(t?.triage_note).toBe('project unclear');
    expect(t?.triage_confidence).toBe(0.4);
  });

  it('flags a needs_human draft even at high confidence', () => {
    const stdout = '{"project":"TST","priority":"high","area":"client","confidence":0.99,"needs_human":true,"triage_note":"looks like a decision"}';
    applyTriageResult('TST-001', stdout, projectIndexes as never, 0.8);
    const t = projectIndexes[0].index.getTask('TST-001');
    expect(t?.status).toBe('draft');
    expect(t?.triage_note).toBe('looks like a decision');
  });

  it('falls back to a manual-review note on malformed Haiku output', () => {
    applyTriageResult('TST-001', 'garbage not json', projectIndexes as never, 0.8);
    const t = projectIndexes[0].index.getTask('TST-001');
    expect(t?.status).toBe('draft');
    expect(t?.triage_note).toContain('Auto-triage unavailable');
  });

  it('persists triage fields to markdown and they survive rebuild-index', () => {
    const stdout = '{"project":"TST","priority":"low","area":"personal","confidence":0.3,"needs_human":true,"triage_note":"needs your call"}';
    applyTriageResult('TST-001', stdout, projectIndexes as never, 0.8);
    // markdown frontmatter has the note
    const md = new MarkdownStore().read(path.join(tasksDir, 'TST-001.md'));
    expect(md.triage_note).toBe('needs your call');
    expect(md.triage_confidence).toBe(0.3);
    // rebuild a fresh index purely from markdown — fields survive
    const rebuilt = new SqliteIndex(path.join(tempDir, 'rebuild.db'));
    rebuilt.init();
    new Reconciler(rebuilt, tasksDir, 'TST').reconcile();
    const t = rebuilt.getTask('TST-001');
    expect(t?.triage_note).toBe('needs your call');
    expect(t?.triage_confidence).toBe(0.3);
    rebuilt.close();
  });
});
