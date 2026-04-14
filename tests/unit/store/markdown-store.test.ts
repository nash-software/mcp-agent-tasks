import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MarkdownStore } from '../../../src/store/markdown-store.js';
import { McpTasksError } from '../../../src/types/errors.js';
import type { Task } from '../../../src/types/task.js';

const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'tasks');

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tasks-test-'));
}

function copyFixture(tmpDir: string, filename: string): string {
  const src = path.join(FIXTURES_DIR, filename);
  const dest = path.join(tmpDir, filename);
  fs.copyFileSync(src, dest);
  return dest;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    id: 'TEST-001',
    title: 'Test task',
    type: 'feature',
    status: 'todo',
    priority: 'medium',
    project: 'TEST',
    tags: ['alpha', 'beta'],
    complexity: 3,
    complexity_manual: false,
    why: 'Because testing is important.',
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
    files: ['src/foo.ts'],
    body: '## Context\n\nSome body text.',
    file_path: '',
    ...overrides,
  };
}

describe('MarkdownStore', () => {
  let store: MarkdownStore;
  let tmpDir: string;

  beforeEach(() => {
    store = new MarkdownStore();
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('read()', () => {
    it('parses a valid fixture and returns correct Task fields', () => {
      const filePath = copyFixture(tmpDir, 'HERALD-001.md');
      const task = store.read(filePath);

      expect(task.id).toBe('HERALD-001');
      expect(task.schema_version).toBe(1);
      expect(task.title).toBe('Set up WebSocket connection to Python sidecar');
      expect(task.type).toBe('feature');
      expect(task.status).toBe('todo');
      expect(task.priority).toBe('high');
      expect(task.project).toBe('HERALD');
      expect(task.tags).toContain('ipc');
      expect(task.tags).toContain('websocket');
      expect(task.complexity).toBe(4);
      expect(task.dependencies).toEqual([]);
      expect(task.body).toContain('WebSocket connection');
      expect(task.file_path).toBe(filePath);
    });

    it('parses HERALD-002 with subtasks, commits, and dependencies', () => {
      const filePath = copyFixture(tmpDir, 'HERALD-002.md');
      const task = store.read(filePath);

      expect(task.id).toBe('HERALD-002');
      expect(task.dependencies).toContain('HERALD-001');
      expect(task.subtasks).toHaveLength(3);
      expect(task.git.commits).toHaveLength(1);
      expect(task.transitions).toHaveLength(1);
    });

    it('throws SCHEMA_MISMATCH for corrupt frontmatter', () => {
      const filePath = copyFixture(tmpDir, 'HERALD-corrupt.md');
      expect(() => store.read(filePath)).toThrow(McpTasksError);

      try {
        store.read(filePath);
      } catch (err) {
        expect(err).toBeInstanceOf(McpTasksError);
        expect((err as McpTasksError).code).toBe('SCHEMA_MISMATCH');
      }
    });

    it('throws TASK_NOT_FOUND for missing file', () => {
      expect(() => store.read(path.join(tmpDir, 'nonexistent.md'))).toThrow(McpTasksError);
      try {
        store.read(path.join(tmpDir, 'nonexistent.md'));
      } catch (err) {
        expect((err as McpTasksError).code).toBe('TASK_NOT_FOUND');
      }
    });
  });

  describe('write() roundtrip', () => {
    it('writes then reads back with same fields', () => {
      const filePath = path.join(tmpDir, 'TEST-001.md');
      const task = makeTask({ file_path: filePath });

      store.write(task);
      expect(fs.existsSync(filePath)).toBe(true);

      const readBack = store.read(filePath);
      expect(readBack.id).toBe(task.id);
      expect(readBack.title).toBe(task.title);
      expect(readBack.type).toBe(task.type);
      expect(readBack.status).toBe(task.status);
      expect(readBack.priority).toBe(task.priority);
      expect(readBack.project).toBe(task.project);
      expect(readBack.tags).toEqual(task.tags);
      expect(readBack.why).toContain('testing');
      expect(readBack.body).toContain('Some body text');
      expect(readBack.files).toEqual(task.files);
    });

    it('updates updated and last_activity timestamps on write', () => {
      const filePath = path.join(tmpDir, 'TEST-001.md');
      const before = new Date('2020-01-01T00:00:00Z').toISOString();
      const task = makeTask({ file_path: filePath, updated: before, last_activity: before });

      store.write(task);

      const readBack = store.read(filePath);
      expect(readBack.updated).not.toBe(before);
      expect(readBack.last_activity).not.toBe(before);
    });

    it('no .tmp file remains after write', () => {
      const filePath = path.join(tmpDir, 'TEST-001.md');
      const task = makeTask({ file_path: filePath });
      store.write(task);

      const tmpFile = filePath + '.tmp';
      expect(fs.existsSync(tmpFile)).toBe(false);
    });
  });

  describe('frontmatter cap enforcement', () => {
    it('caps transitions at 100 on write', () => {
      const filePath = path.join(tmpDir, 'TEST-001.md');
      const now = new Date().toISOString();
      const transitions = Array.from({ length: 110 }, (_, i) => ({
        from: 'todo' as const,
        to: 'in_progress' as const,
        at: now,
        reason: `transition-${i}`,
      }));

      const task = makeTask({ file_path: filePath, transitions });
      store.write(task);

      const readBack = store.read(filePath);
      expect(readBack.transitions.length).toBeLessThanOrEqual(100);
    });

    it('caps git.commits at 50 on write', () => {
      const filePath = path.join(tmpDir, 'TEST-001.md');
      const commits = Array.from({ length: 60 }, (_, i) => ({
        sha: `sha${i}`,
        message: `commit ${i}`,
        authored_at: new Date().toISOString(),
      }));

      const task = makeTask({ file_path: filePath, git: { commits } });
      store.write(task);

      const readBack = store.read(filePath);
      expect(readBack.git.commits.length).toBeLessThanOrEqual(50);
    });
  });

  describe('delete()', () => {
    it('moves file to archive/ directory in same parent', () => {
      const filePath = path.join(tmpDir, 'TEST-001.md');
      const task = makeTask({ file_path: filePath });
      store.write(task);
      expect(fs.existsSync(filePath)).toBe(true);

      store.delete(filePath);

      expect(fs.existsSync(filePath)).toBe(false);
      const archivePath = path.join(tmpDir, 'archive', 'TEST-001.md');
      expect(fs.existsSync(archivePath)).toBe(true);
    });
  });

  describe('labels/tags alias + new fields (Step 6)', () => {
    it('merges tags and labels from frontmatter into deduped array', () => {
      // Hand-craft a file with both tags and labels in frontmatter
      const filePath = path.join(tmpDir, 'TEST-alias.md');
      const content = `---
schema_version: 1
id: TEST-001
title: Alias test
type: feature
status: todo
priority: medium
project: TEST
tags:
  - alpha
labels:
  - beta
  - alpha
why: Testing alias
created: "2026-01-01T00:00:00.000Z"
updated: "2026-01-01T00:00:00.000Z"
last_activity: "2026-01-01T00:00:00.000Z"
---

Body text.
`;
      fs.writeFileSync(filePath, content, 'utf-8');
      const task = store.read(filePath);
      // Should merge both, deduplicate
      expect(task.tags).toContain('alpha');
      expect(task.tags).toContain('beta');
      // alpha should appear only once
      expect(task.tags.filter(t => t === 'alpha')).toHaveLength(1);
      expect(task.labels).toEqual(task.tags);
    });

    it('write serializes as labels (and tags for compat); round-trips correctly', () => {
      const filePath = path.join(tmpDir, 'TEST-write-alias.md');
      const task = makeTask({ file_path: filePath, tags: ['x', 'y'] });
      store.write(task);

      const raw = fs.readFileSync(filePath, 'utf-8');
      expect(raw).toContain('labels:');
      expect(raw).toContain('tags:');

      const readBack = store.read(filePath);
      expect(readBack.tags).toContain('x');
      expect(readBack.tags).toContain('y');
    });

    it('round-trips references', () => {
      const filePath = path.join(tmpDir, 'TEST-refs.md');
      const task = makeTask({
        file_path: filePath,
        references: [{ type: 'closes', id: 'TEST-002' }],
      });
      store.write(task);
      const readBack = store.read(filePath);
      expect(readBack.references).toHaveLength(1);
      expect(readBack.references![0]!.type).toBe('closes');
      expect(readBack.references![0]!.id).toBe('TEST-002');
    });

    it('round-trips auto_captured and milestone', () => {
      const filePath = path.join(tmpDir, 'TEST-captured.md');
      const task = makeTask({
        file_path: filePath,
        auto_captured: true,
        milestone: 'v2.0',
      });
      store.write(task);
      const readBack = store.read(filePath);
      expect(readBack.auto_captured).toBe(true);
      expect(readBack.milestone).toBe('v2.0');
    });
  });
});
