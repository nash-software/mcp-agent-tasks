import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ManifestWriter } from '../../../src/store/manifest-writer.js';
import type { Task } from '../../../src/types/task.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-manifest-test-'));
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
    tags: [],
    complexity: 3,
    complexity_manual: false,
    why: 'Because testing.',
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
    body: 'Body',
    file_path: '/tmp/TEST-001.md',
    ...overrides,
  };
}

describe('ManifestWriter', () => {
  let tmpDir: string;
  let writer: ManifestWriter;

  beforeEach(() => {
    tmpDir = makeTempDir();
    writer = new ManifestWriter();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('write() + read() roundtrip', () => {
    it('tasks in equals tasks out (count and IDs match)', () => {
      const tasks = [
        makeTask({ id: 'TEST-001' }),
        makeTask({ id: 'TEST-002' }),
        makeTask({ id: 'TEST-003' }),
      ];

      writer.write(tmpDir, tasks, 4, 'TEST');

      const entries = writer.read(tmpDir);
      expect(entries).toHaveLength(3);
      const ids = entries.map(e => e.id);
      expect(ids).toContain('TEST-001');
      expect(ids).toContain('TEST-002');
      expect(ids).toContain('TEST-003');
    });

    it('preserves task fields in manifest entries', () => {
      const task = makeTask({
        id: 'TEST-001',
        title: 'My task',
        status: 'in_progress',
        priority: 'high',
        complexity: 7,
        dependencies: ['TEST-000'],
      });

      writer.write(tmpDir, [task], 2, 'TEST');

      const entries = writer.read(tmpDir);
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      expect(entry.id).toBe('TEST-001');
      expect(entry.title).toBe('My task');
      expect(entry.status).toBe('in_progress');
      expect(entry.priority).toBe('high');
      expect(entry.complexity).toBe(7);
      expect(entry.dependencies).toContain('TEST-000');
    });

    it('computes subtask_progress correctly', () => {
      const task = makeTask({
        id: 'TEST-001',
        subtasks: [
          { id: 'TEST-001.1', title: 'Done', status: 'done' },
          { id: 'TEST-001.2', title: 'Todo', status: 'todo' },
          { id: 'TEST-001.3', title: 'Also done', status: 'done' },
        ],
      });

      writer.write(tmpDir, [task], 2, 'TEST');

      const entries = writer.read(tmpDir);
      expect(entries[0].subtask_progress).toBe('2/3');
    });

    it('has_pr=true when git.pr is set', () => {
      const task = makeTask({
        git: {
          commits: [],
          pr: {
            number: 42,
            url: 'https://github.com/owner/repo/pull/42',
            title: 'feat: cool thing',
            state: 'open',
            merged_at: null,
            base_branch: 'main',
          },
        },
      });

      writer.write(tmpDir, [task], 2, 'TEST');

      const entries = writer.read(tmpDir);
      expect(entries[0].has_pr).toBe(true);
    });

    it('has_pr=false when git.pr is not set', () => {
      writer.write(tmpDir, [makeTask()], 2, 'TEST');
      const entries = writer.read(tmpDir);
      expect(entries[0].has_pr).toBe(false);
    });
  });

  describe('atomic write', () => {
    it('index.yaml exists after write, no .tmp remains', () => {
      writer.write(tmpDir, [makeTask()], 2, 'TEST');

      expect(fs.existsSync(path.join(tmpDir, 'index.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'index.yaml.tmp'))).toBe(false);
    });
  });

  describe('read() edge cases', () => {
    it('returns empty array when index.yaml does not exist', () => {
      const entries = writer.read(tmpDir);
      expect(entries).toEqual([]);
    });

    it('write empty task list produces valid yaml', () => {
      writer.write(tmpDir, [], 1, 'TEST');
      const entries = writer.read(tmpDir);
      expect(entries).toEqual([]);
    });
  });
});
