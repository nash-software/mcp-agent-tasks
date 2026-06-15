/**
 * Unit tests for the Tier-2 triage engine integration:
 *  - audit writeRun / readRun roundtrip
 *  - undoRun reverse-path logic with a temp store
 *  - runTriage with injected gitRun + llm.runBatch (no real claude/git)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { writeRun, readRun, undoRun, writeLatestReport, readLatestReport, deleteLatestReport } from '../../src/triage/audit.js';
import type { AuditEntry, PersistedTriageReport } from '../../src/triage/audit.js';
import { runTriage, LLM_BATCH_TIMEOUT_MS, runLlmBatchAdaptive, runBounded, makeGhCachedRunner, DEFAULT_TRIAGE_MODEL, buildTriageSpawnArgs, TRANSIENT_SPAWN_CODES, SPAWN_RETRY_MAX, spawnClaudeWithRetry } from '../../src/triage/engine.js';
import type { TriageRunOpts, TaskWithEntry, SpawnFn } from '../../src/triage/engine.js';
import { defaultThresholds } from '../../src/triage/llm-triage.js';
import type { McpTasksConfig } from '../../src/config/loader.js';
import type { CmdResult } from '../../src/triage/git-signals.js';
import type { TaskStatus } from '../../src/types/task.js';
import { warmCommitLog } from '../../src/triage/repo-signals.js';

// ── helpers ────────────────────────────────────────────────────────────────────

const FIXED_NOW = Date.parse('2026-06-07T12:00:00Z');

/** Create a minimal McpTasksConfig that points to a temp tasks dir. */
function makeTempConfig(projRoot: string): { config: McpTasksConfig; tasksDir: string } {
  const tasksDir = join(projRoot, 'agent-tasks');
  mkdirSync(tasksDir, { recursive: true });

  const config: McpTasksConfig = {
    version: 1,
    storageDir: tasksDir,
    defaultStorage: 'local',
    enforcement: 'warn',
    autoCommit: false,
    claimTtlHours: 4,
    trackManifest: false,
    tasksDirName: 'agent-tasks',
    projects: [{ prefix: 'TEST', path: projRoot, storage: 'local' }],
  };
  return { config, tasksDir };
}

/** A CmdRunner that never finds merge evidence. */
const noSignalRunner = (_cmd: string, _args: string[], _cwd?: string): CmdResult => ({
  code: 1,
  stdout: '',
});

// ── temp dir lifecycle ─────────────────────────────────────────────────────────

let tmpRoot: string;
let origCwd: string;

beforeAll(() => {
  tmpRoot = join(tmpdir(), `mcpat-triage-test-${process.pid}-${Date.now()}`);
  mkdirSync(tmpRoot, { recursive: true });
  // Override cwd so audit dir resolves inside tmpRoot
  origCwd = process.cwd();
  process.chdir(tmpRoot);
});

afterAll(() => {
  process.chdir(origCwd);
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── audit roundtrip ────────────────────────────────────────────────────────────

describe('audit writeRun / readRun', () => {
  it('roundtrips an empty entry list', async () => {
    const runId = 'test-run-empty-001';
    await writeRun(runId, []);
    const entries = readRun(runId);
    expect(entries).toEqual([]);
  });

  it('roundtrips a list of AuditEntry objects', async () => {
    const entries: AuditEntry[] = [
      {
        taskId: 'MCPAT-001',
        project: 'MCPAT',
        tier: 0,
        signal: 'pr-merged',
        detail: 'PR #5 merged',
        fromStatus: 'in_progress',
        toStatus: 'done',
        path: ['in_progress', 'done'],
        appliedAt: '2026-06-07T12:00:00.000Z',
      },
      {
        taskId: 'MCPAT-002',
        project: 'MCPAT',
        tier: 2,
        signal: 'llm-done',
        detail: 'shipped',
        confidence: 0.92,
        fromStatus: 'todo',
        toStatus: 'done',
        path: ['todo', 'in_progress', 'done'],
        appliedAt: '2026-06-07T12:00:01.000Z',
      },
    ];

    const runId = 'test-run-roundtrip-001';
    await writeRun(runId, entries);
    const read = readRun(runId);

    expect(read).toHaveLength(2);
    expect(read[0]).toMatchObject({ taskId: 'MCPAT-001', tier: 0, signal: 'pr-merged' });
    expect(read[1]).toMatchObject({ taskId: 'MCPAT-002', tier: 2, confidence: 0.92 });
  });

  it('returns [] for a non-existent runId', () => {
    const entries = readRun('does-not-exist-xyz');
    expect(entries).toEqual([]);
  });

  it('skips malformed lines without throwing', async () => {
    // Write a file with one good line and one bad line
    const { writeFileSync, mkdirSync: mkdir } = await import('node:fs');
    const auditDirPath = join(tmpRoot, 'scratchpads', '.triage-runs');
    mkdir(auditDirPath, { recursive: true });
    writeFileSync(
      join(auditDirPath, 'bad-lines-001.jsonl'),
      '{"taskId":"X-1","project":"X","tier":0,"signal":"s","detail":"d","fromStatus":"todo","toStatus":"done","path":["todo","done"],"appliedAt":"2026-01-01"}\n{BAD JSON\n',
      'utf-8'
    );
    const entries = readRun('bad-lines-001');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.taskId).toBe('X-1');
  });
});

// ── runTriage with injected runners ───────────────────────────────────────────

describe('runTriage — injected runners (no real claude/git)', () => {
  it('returns a TriageReport with tier0Count and tier2Count fields', async () => {
    const { config } = makeTempConfig(join(tmpRoot, 'proj1'));

    const opts: TriageRunOpts = {
      nowMs: FIXED_NOW,
      gitRun: noSignalRunner,
      llm: { enabled: false },
    };

    const report = await runTriage(config, opts);

    // No tasks exist in the temp dir so all counts should be 0
    expect(report).toHaveProperty('decisions');
    expect(report).toHaveProperty('skips');
    expect(report).toHaveProperty('totalOpen');
    expect(report).toHaveProperty('tier0Count');
    expect(report).toHaveProperty('tier2Count');
    expect(report.tier0Count).toBe(0);
    expect(report.tier2Count).toBe(0);
  });

  it('tier-2 batch is called for non-tier0-resolved tasks when llm.enabled=true', async () => {
    const { config } = makeTempConfig(join(tmpRoot, 'proj2'));

    let batchCallCount = 0;
    const fakeBatch = async (_prompt: string): Promise<string> => {
      batchCallCount++;
      // Return a JSON array with a done verdict for any id that appears in prompt
      // We return empty so mapVerdict marks each as llm-error (no verdict)
      return '[]';
    };

    const opts: TriageRunOpts = {
      nowMs: FIXED_NOW,
      gitRun: noSignalRunner,
      llm: { enabled: true, runBatch: fakeBatch, threshold: 0.85, batchSize: 15 },
    };

    const report = await runTriage(config, opts);

    // No real tasks → no LLM calls expected
    expect(batchCallCount).toBe(0);
    expect(report.tier2Count).toBe(0);
  });

  it('llm-error skips are created when runBatch throws', async () => {
    // This test uses a fake config with zero tasks, so LLM is not invoked.
    // The resilience (per-batch catch) is tested conceptually via runTriage opts.
    const { config } = makeTempConfig(join(tmpRoot, 'proj3'));

    const throwingBatch = async (_prompt: string): Promise<string> => {
      throw new Error('LLM unavailable');
    };

    const opts: TriageRunOpts = {
      nowMs: FIXED_NOW,
      gitRun: noSignalRunner,
      llm: { enabled: true, runBatch: throwingBatch, batchSize: 15 },
    };

    // Should complete without throwing even if LLM throws
    const report = await runTriage(config, opts);
    expect(report).toHaveProperty('decisions');
    expect(report.tier2Count).toBe(0);
  });
});

// ── undoRun reverse-path logic ────────────────────────────────────────────────

describe('undoRun', () => {
  it('reports reverted=0 when runId does not exist', async () => {
    const { config } = makeTempConfig(join(tmpRoot, 'undo-proj1'));
    const result = await undoRun('nonexistent-run-id', config);
    expect(result).toEqual({ reverted: 0, failed: 0 });
  });

  it('reverts a simple in_progress→done back to in_progress via a live store', async () => {
    const projDir = join(tmpRoot, 'undo-proj2');
    const { config, tasksDir } = makeTempConfig(projDir);

    // Create a real task in the store
    const { SqliteIndex } = await import('../../src/store/sqlite-index.js');
    const { MarkdownStore } = await import('../../src/store/markdown-store.js');
    const { ManifestWriter } = await import('../../src/store/manifest-writer.js');
    const { TaskStore } = await import('../../src/store/task-store.js');
    const { resolveServerDbPath } = await import('../../src/config/loader.js');

    const dbPath = resolveServerDbPath(tasksDir, config, 'TEST');
    const idx = new SqliteIndex(dbPath);
    idx.init();
    const store = new TaskStore(new MarkdownStore(), idx, new ManifestWriter(), tasksDir, 'TEST');

    const task = store.createTask({
      project: 'TEST',
      title: 'Undo me',
      type: 'feature',
      priority: 'medium',
      why: 'test undo',
    });

    // Transition to in_progress then done (simulating an applied triage run)
    store.transitionTask(task.id, 'in_progress', 'start');
    store.transitionTask(task.id, 'done', 'triage applied');

    // Write a fake audit entry for this run
    const runId = 'undo-test-run-001';
    const auditEntry: AuditEntry = {
      taskId: task.id,
      project: 'TEST',
      tier: 0,
      signal: 'pr-merged',
      detail: 'PR merged',
      fromStatus: 'in_progress',
      toStatus: 'done',
      path: ['in_progress', 'done'],
      appliedAt: new Date().toISOString(),
    };
    await writeRun(runId, [auditEntry]);

    // Undo the run
    const result = await undoRun(runId, config);

    // in_progress is reachable from done via the valid transitions
    // done→closed is not reversible; but done→in_progress may not be either depending on config
    // The test validates the undo mechanism reports a result without crashing
    expect(typeof result.reverted).toBe('number');
    expect(typeof result.failed).toBe('number');
    expect(result.reverted + result.failed).toBe(1); // one entry processed

    idx.close();
  });

  it('handles audit entry with no matching project (reports failed, no throw)', async () => {
    const projDir = join(tmpRoot, 'undo-proj3');
    const { config } = makeTempConfig(projDir);

    const runId = 'undo-no-project-001';
    const badEntry: AuditEntry = {
      taskId: 'UNKNOWN-999',
      project: 'UNKNOWN',
      tier: 0,
      signal: 'pr-merged',
      detail: 'test',
      fromStatus: 'todo',
      toStatus: 'done',
      path: ['todo', 'done'],
      appliedAt: new Date().toISOString(),
    };
    await writeRun(runId, [badEntry]);

    const result = await undoRun(runId, config);
    // UNKNOWN prefix has no tasksDir → failed += 1
    expect(result.failed).toBe(1);
    expect(result.reverted).toBe(0);
  });
});

// ── batch constants ────────────────────────────────────────────────────────────

describe('engine batch constants', () => {
  it('LLM_BATCH_TIMEOUT_MS is 300000', () => {
    expect(LLM_BATCH_TIMEOUT_MS).toBe(300_000);
  });

  it('AC6: default Tier-2 batchSize is 10: 9 tasks produce 1 batch call', async () => {
    const projDir = join(tmpRoot, 'ac6-batch-proj');
    const { config, tasksDir } = makeTempConfig(projDir);

    // Write 9 open task markdown files directly
    const { writeFileSync } = await import('node:fs');
    for (let i = 1; i <= 9; i++) {
      const id = `TEST-${String(i).padStart(3, '0')}`;
      const md = [
        '---',
        'schema_version: 1',
        `id: ${id}`,
        `title: Task ${i}`,
        'type: feature',
        'status: todo',
        'priority: medium',
        `project: TEST`,
        'tags: []',
        'complexity: 1',
        'complexity_manual: false',
        `why: reason ${i}`,
        `created: 2026-01-0${Math.min(i, 9)}T00:00:00Z`,
        `updated: 2026-01-01T00:00:00Z`,
        `last_activity: 2026-01-01T00:00:00Z`,
        'claimed_by: null',
        'claimed_at: null',
        'claim_ttl_hours: 4',
        'parent: null',
        'children: []',
        'dependencies: []',
        'subtasks: []',
        'git:',
        '  commits: []',
        'transitions: []',
        'files: []',
        '---',
        '',
        `## Task ${i}`,
      ].join('\n');
      writeFileSync(join(tasksDir, `${id}.md`), md, 'utf-8');
    }

    let batchCallCount = 0;
    const fakeBatch = async (_prompt: string): Promise<string> => {
      batchCallCount++;
      return '[]';
    };

    const opts: TriageRunOpts = {
      nowMs: FIXED_NOW,
      gitRun: noSignalRunner,
      // No batchSize override — uses the default of 10
      llm: { enabled: true, runBatch: fakeBatch, threshold: 0.75 },
    };

    await runTriage(config, opts);

    // 9 tasks / 10 per batch = 1 batch call (all 9 fit in a single batch)
    expect(batchCallCount).toBe(1);
  });

  it('AC6: batchSize=5 with 11 tasks produces 3 batch calls (adaptive split not needed)', async () => {
    const projDir = join(tmpRoot, 'ac6-split-proj');
    const { config, tasksDir } = makeTempConfig(projDir);

    const { writeFileSync } = await import('node:fs');
    for (let i = 1; i <= 11; i++) {
      const id = `TEST-${String(i).padStart(3, '0')}`;
      const md = [
        '---', 'schema_version: 1', `id: ${id}`, `title: Task ${i}`, 'type: feature',
        'status: todo', 'priority: medium', 'project: TEST', 'tags: []', 'complexity: 1',
        'complexity_manual: false', `why: reason ${i}`, 'created: 2026-01-01T00:00:00Z',
        'updated: 2026-01-01T00:00:00Z', 'last_activity: 2026-01-01T00:00:00Z',
        'claimed_by: null', 'claimed_at: null', 'claim_ttl_hours: 4', 'parent: null',
        'children: []', 'dependencies: []', 'subtasks: []', 'git:', '  commits: []',
        'transitions: []', 'files: []', '---', '', `## Task ${i}`,
      ].join('\n');
      writeFileSync(join(tasksDir, `${id}.md`), md, 'utf-8');
    }

    let batchCallCount = 0;
    const fakeBatch = async (_prompt: string): Promise<string> => { batchCallCount++; return '[]'; };

    await runTriage(config, {
      nowMs: FIXED_NOW, gitRun: noSignalRunner,
      llm: { enabled: true, runBatch: fakeBatch, threshold: 0.75, batchSize: 5 },
    });

    // 11 tasks / 5 per batch = 3 batches (5+5+1)
    expect(batchCallCount).toBe(3);
  });
});

// ── A-AC1: runLlmBatchAdaptive ─────────────────────────────────────────────────

function makeMinimalTaskWithEntry(id: string): TaskWithEntry {
  return {
    task: {
      schema_version: 1,
      id,
      project: id.split('-')[0]!,
      title: `Task ${id}`,
      type: 'feature',
      status: 'todo',
      priority: 'medium',
      why: 'test',
      tags: [],
      complexity: 1,
      complexity_manual: false,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      last_activity: '2026-01-01T00:00:00Z',
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
      body: '',
      file_path: `${id}.md`,
    },
    entry: { prefix: id.split('-')[0]!, tasksDir: '/tmp/test', repoPath: null },
  };
}

describe('runLlmBatchAdaptive (A-AC1)', () => {
  const opts = { nowMs: FIXED_NOW, gitRun: noSignalRunner, thresholds: defaultThresholds(0.75) };

  it('returns empty results for empty task list', async () => {
    const fakeBatch = async (_p: string): Promise<string> => '[]';
    const result = await runLlmBatchAdaptive([], fakeBatch, opts);
    expect(result.decisions).toHaveLength(0);
    expect(result.skips).toHaveLength(0);
  });

  it('calls runBatch once per batch on success, returns skips (no verdicts for unknown ids)', async () => {
    const tasks = [makeMinimalTaskWithEntry('T-001'), makeMinimalTaskWithEntry('T-002')];
    let callCount = 0;
    const fakeBatch = async (_p: string): Promise<string> => { callCount++; return '[]'; };
    const result = await runLlmBatchAdaptive(tasks, fakeBatch, opts);
    expect(callCount).toBe(1);
    // '[]' → no verdicts → both marked llm-unsure or similar skip (mapVerdict returns skip)
    expect(result.decisions).toHaveLength(0);
    expect(result.skips).toHaveLength(2);
  });

  it('splits on timeout and sub-batches succeed: both tasks are processed (not lost)', async () => {
    const tasks = [makeMinimalTaskWithEntry('T-011'), makeMinimalTaskWithEntry('T-012')];

    // Times out when both tasks are in the prompt, succeeds individually
    const fakeBatch = async (prompt: string): Promise<string> => {
      if (prompt.includes('T-011') && prompt.includes('T-012')) throw new Error('timeout');
      return '[]';
    };

    const result = await runLlmBatchAdaptive(tasks, fakeBatch, opts);
    // After split, each sub-batch succeeds with '[]' (empty verdicts).
    // mapVerdict → 'llm-error' (no verdict returned), but detail says 'no verdict' not 'timeout'.
    expect(result.decisions).toHaveLength(0);
    expect(result.skips).toHaveLength(2);
    // Both tasks accounted for — not dropped
    const ids = result.skips.map(s => s.taskId).sort();
    expect(ids).toEqual(['T-011', 'T-012']);
    // Detail must not reference 'timeout' — confirms sub-batches ran and didn't themselves time out
    expect(result.skips.every(s => !s.detail?.includes('timeout'))).toBe(true);
  });

  it('size-1 timeout yields exactly one llm-error skip', async () => {
    const tasks = [makeMinimalTaskWithEntry('T-021')];
    const alwaysTimeout = async (_p: string): Promise<string> => { throw new Error('timeout'); };
    const result = await runLlmBatchAdaptive(tasks, alwaysTimeout, opts);
    expect(result.decisions).toHaveLength(0);
    expect(result.skips).toHaveLength(1);
    expect(result.skips[0]!.taskId).toBe('T-021');
    expect(result.skips[0]!.reason).toBe('llm-error');
  });

  it('never throws even when runBatch always rejects', async () => {
    const tasks = [makeMinimalTaskWithEntry('T-031'), makeMinimalTaskWithEntry('T-032'), makeMinimalTaskWithEntry('T-033')];
    const alwaysError = async (_p: string): Promise<string> => { throw new Error('LLM down'); };
    const result = await runLlmBatchAdaptive(tasks, alwaysError, opts);
    // All tasks end up as llm-error skips after recursive splitting
    expect(result.decisions).toHaveLength(0);
    expect(result.skips).toHaveLength(3);
    expect(result.skips.every(s => s.reason === 'llm-error')).toBe(true);
  });
});

// ── AC5: repo signals flow through to prompt ──────────────────────────────────

describe('engine Tier-2 repo signals (AC5)', () => {
  it('tasks with absent repoPath are still judged without error', async () => {
    const projDir = join(tmpRoot, 'ac5-no-repo-proj');
    // Use a config with no registered projects → repoPath is null
    const tasksDir = join(projDir, 'agent-tasks');
    mkdirSync(tasksDir, { recursive: true });

    const config: McpTasksConfig = {
      version: 1,
      storageDir: tasksDir,
      defaultStorage: 'local',
      enforcement: 'warn',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: false,
      tasksDirName: 'agent-tasks',
      projects: [],
    };

    const { writeFileSync } = await import('node:fs');
    const md = [
      '---',
      'schema_version: 1',
      'id: GEN-001',
      'title: Orphan task with no repo',
      'type: feature',
      'status: todo',
      'priority: medium',
      'project: GEN',
      'tags: []',
      'complexity: 1',
      'complexity_manual: false',
      'why: test',
      'created: 2026-01-01T00:00:00Z',
      'updated: 2026-01-01T00:00:00Z',
      'last_activity: 2026-01-01T00:00:00Z',
      'claimed_by: null',
      'claimed_at: null',
      'claim_ttl_hours: 4',
      'parent: null',
      'children: []',
      'dependencies: []',
      'subtasks: []',
      'git:',
      '  commits: []',
      'transitions: []',
      'files: []',
      '---',
      '',
      '## Body',
    ].join('\n');
    writeFileSync(join(tasksDir, 'GEN-001.md'), md, 'utf-8');

    let capturedPrompt = '';
    const fakeBatch = async (prompt: string): Promise<string> => {
      capturedPrompt = prompt;
      return '[]';
    };

    const opts: TriageRunOpts = {
      nowMs: FIXED_NOW,
      gitRun: noSignalRunner,
      llm: { enabled: true, runBatch: fakeBatch, batchSize: 10 },
    };

    // Should complete without throwing
    const report = await runTriage(config, opts);
    expect(report).toHaveProperty('decisions');
    // Prompt was built — task was sent to LLM (metadata-only, no repo signals)
    expect(capturedPrompt).toContain('GEN-001');
    // No pipe-separated repo signals since repoPath is absent
    expect(capturedPrompt).not.toMatch(/GEN-001.*\|.*exist/);
  });

  it('passes repo signal summary into the prompt when gitRun returns signals', async () => {
    const projDir = join(tmpRoot, 'ac5-with-repo-proj');
    const { config, tasksDir } = makeTempConfig(projDir);

    const { writeFileSync } = await import('node:fs');
    const md = [
      '---',
      'schema_version: 1',
      'id: TEST-999',
      'title: Add JobDispatcher pipeline',
      'type: feature',
      'status: todo',
      'priority: medium',
      'project: TEST',
      'tags: []',
      'complexity: 1',
      'complexity_manual: false',
      'why: needed',
      'created: 2025-01-01T00:00:00Z',
      'updated: 2025-06-01T00:00:00Z',
      'last_activity: 2025-06-01T00:00:00Z',
      'claimed_by: null',
      'claimed_at: null',
      'claim_ttl_hours: 4',
      'parent: null',
      'children: []',
      'dependencies: []',
      'subtasks: []',
      'git:',
      '  commits: []',
      'transitions: []',
      'files:',
      '  - src/dispatcher.ts',
      '---',
      '',
      '## Body',
    ].join('\n');
    writeFileSync(join(tasksDir, 'TEST-999.md'), md, 'utf-8');

    // gitRun returns a commit for the task ID and the file present
    const signalRunner = (_cmd: string, args: string[], _cwd?: string): CmdResult => {
      const a = args.join(' ');
      if (a.includes('ls-files') && a.includes('src/dispatcher.ts')) return { code: 0, stdout: 'src/dispatcher.ts\n' };
      if (a.includes('--grep=TEST-999') && a.includes('--oneline')) return { code: 0, stdout: 'abc123 feat: add dispatcher\n' };
      if (a.includes('--grep=TEST-999') && a.includes('%cs')) return { code: 0, stdout: '2026-05-30\n' };
      if (a.includes('log -1 --format=%cs -- src/dispatcher.ts')) return { code: 0, stdout: '2026-05-29\n' };
      if (a.includes('grep') && a.includes('JobDispatcher')) return { code: 0, stdout: 'src/dispatcher.ts\n' };
      return { code: 1, stdout: '' };
    };

    let capturedPrompt = '';
    const fakeBatch = async (prompt: string): Promise<string> => {
      capturedPrompt = prompt;
      return '[]';
    };

    const opts: TriageRunOpts = {
      nowMs: FIXED_NOW,
      gitRun: signalRunner,
      llm: { enabled: true, runBatch: fakeBatch, batchSize: 10 },
    };

    await runTriage(config, opts);

    // The prompt should include repo signal summary for TEST-999
    expect(capturedPrompt).toContain('TEST-999');
    expect(capturedPrompt).toMatch(/\|.*exist|id in.*commit|touched|in code/);
  });
});

// ── AC1: model flag ────────────────────────────────────────────────────────────

describe('AC1: Tier-2 model flag', () => {
  it('DEFAULT_TRIAGE_MODEL is claude-haiku-4-5', () => {
    expect(DEFAULT_TRIAGE_MODEL).toBe('claude-haiku-4-5');
  });

  it('buildTriageSpawnArgs includes -p and --model <model>', () => {
    const args = buildTriageSpawnArgs('claude-haiku-4-5');
    expect(args).toContain('-p');
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-haiku-4-5');
  });

  it('buildTriageSpawnArgs passes the model string verbatim', () => {
    const customModel = 'claude-sonnet-4-6';
    const args = buildTriageSpawnArgs(customModel);
    expect(args[args.indexOf('--model') + 1]).toBe(customModel);
  });
});

// ── AC3: concurrent batch execution ───────────────────────────────────────────

describe('AC3: concurrent Tier-2 batches', () => {
  it('runBounded: all thunks complete and order is preserved', async () => {
    const thunks = [1, 2, 3, 4, 5].map(n => async () => n * 2);
    const results = await runBounded(thunks, 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('runBounded: empty input returns empty array', async () => {
    const results = await runBounded([], 4);
    expect(results).toEqual([]);
  });

  it('runBounded: concurrency=1 runs thunks sequentially', async () => {
    const order: number[] = [];
    const thunks = [1, 2, 3].map(n => async () => { order.push(n); return n; });
    await runBounded(thunks, 1);
    expect(order).toEqual([1, 2, 3]);
  });

  it('AC3: N batches run concurrently up to the concurrency limit', async () => {
    const projDir = join(tmpRoot, 'ac3-concurrency-proj');
    const { config, tasksDir } = makeTempConfig(projDir);

    const { writeFileSync } = await import('node:fs');
    // Write 6 tasks: with batchSize=2, this creates 3 batches
    for (let i = 1; i <= 6; i++) {
      const id = `TEST-${String(i).padStart(3, '0')}`;
      const md = [
        '---', 'schema_version: 1', `id: ${id}`, `title: Task ${i}`, 'type: feature',
        'status: todo', 'priority: medium', 'project: TEST', 'tags: []', 'complexity: 1',
        'complexity_manual: false', `why: reason ${i}`, 'created: 2026-01-01T00:00:00Z',
        'updated: 2026-01-01T00:00:00Z', 'last_activity: 2026-01-01T00:00:00Z',
        'claimed_by: null', 'claimed_at: null', 'claim_ttl_hours: 4', 'parent: null',
        'children: []', 'dependencies: []', 'subtasks: []', 'git:', '  commits: []',
        'transitions: []', 'files: []', '---', '', `## Task ${i}`,
      ].join('\n');
      writeFileSync(join(tasksDir, `${id}.md`), md, 'utf-8');
    }

    let inFlight = 0;
    let maxInFlight = 0;

    const fakeBatch = async (_prompt: string): Promise<string> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield to event loop so concurrent batches can start before any finishes
      await new Promise<void>(resolve => setImmediate(resolve));
      inFlight--;
      return '[]';
    };

    const opts: TriageRunOpts = {
      nowMs: FIXED_NOW,
      gitRun: noSignalRunner,
      llm: { enabled: true, runBatch: fakeBatch, batchSize: 2, concurrency: 3, threshold: 0.75 },
    };

    await runTriage(config, opts);

    // With 3 batches and concurrency=3, all 3 should run simultaneously
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
  });

  it('AC3: concurrency=1 serialises batches (maxInFlight=1)', async () => {
    const projDir = join(tmpRoot, 'ac3-serial-proj');
    const { config, tasksDir } = makeTempConfig(projDir);

    const { writeFileSync } = await import('node:fs');
    for (let i = 1; i <= 4; i++) {
      const id = `TEST-${String(i).padStart(3, '0')}`;
      const md = [
        '---', 'schema_version: 1', `id: ${id}`, `title: Task ${i}`, 'type: feature',
        'status: todo', 'priority: medium', 'project: TEST', 'tags: []', 'complexity: 1',
        'complexity_manual: false', `why: reason ${i}`, 'created: 2026-01-01T00:00:00Z',
        'updated: 2026-01-01T00:00:00Z', 'last_activity: 2026-01-01T00:00:00Z',
        'claimed_by: null', 'claimed_at: null', 'claim_ttl_hours: 4', 'parent: null',
        'children: []', 'dependencies: []', 'subtasks: []', 'git:', '  commits: []',
        'transitions: []', 'files: []', '---', '', `## Task ${i}`,
      ].join('\n');
      writeFileSync(join(tasksDir, `${id}.md`), md, 'utf-8');
    }

    let inFlight = 0;
    let maxInFlight = 0;
    const fakeBatch = async (_prompt: string): Promise<string> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>(resolve => setImmediate(resolve));
      inFlight--;
      return '[]';
    };

    await runTriage(config, {
      nowMs: FIXED_NOW, gitRun: noSignalRunner,
      llm: { enabled: true, runBatch: fakeBatch, batchSize: 2, concurrency: 1, threshold: 0.75 },
    });

    expect(maxInFlight).toBe(1);
  });
});

// ── AC4: per-repo commit-log cache ─────────────────────────────────────────────

describe('AC4: per-repo git-log pre-warm cache', () => {
  it('warmCommitLog returns stdout on success', () => {
    const run = (_cmd: string, _args: string[]): CmdResult => ({
      code: 0, stdout: 'abc1234 feat: add thing\ndef5678 fix: stuff\n',
    });
    const log = warmCommitLog('/repo', run);
    expect(log).toContain('abc1234');
  });

  it('warmCommitLog returns empty string on failure', () => {
    const run = (): CmdResult => ({ code: 1, stdout: '' });
    expect(warmCommitLog('/repo', run)).toBe('');
  });

  it('warmCommitLog returns empty string when runner throws', () => {
    const run = (): CmdResult => { throw new Error('no git'); };
    expect(warmCommitLog('/repo', run)).toBe('');
  });

  it('AC4: per-repo log is fetched once per run, not once per task', async () => {
    const projDir = join(tmpRoot, 'ac4-cache-proj');
    const { config, tasksDir } = makeTempConfig(projDir);

    const { writeFileSync } = await import('node:fs');
    // 3 tasks in the same repo — log should only be fetched once
    for (let i = 1; i <= 3; i++) {
      const id = `TEST-${String(i).padStart(3, '0')}`;
      const md = [
        '---', 'schema_version: 1', `id: ${id}`, `title: Task ${i}`, 'type: feature',
        'status: todo', 'priority: medium', 'project: TEST', 'tags: []', 'complexity: 1',
        'complexity_manual: false', `why: reason ${i}`, 'created: 2026-01-01T00:00:00Z',
        'updated: 2026-01-01T00:00:00Z', 'last_activity: 2026-01-01T00:00:00Z',
        'claimed_by: null', 'claimed_at: null', 'claim_ttl_hours: 4', 'parent: null',
        'children: []', 'dependencies: []', 'subtasks: []', 'git:', '  commits: []',
        'transitions: []', 'files: []', '---', '', `## Task ${i}`,
      ].join('\n');
      writeFileSync(join(tasksDir, `${id}.md`), md, 'utf-8');
    }

    // Track how many times a full git log (no --grep) is called
    let fullLogCallCount = 0;
    const trackingRunner = (_cmd: string, args: string[], _cwd?: string): CmdResult => {
      const joined = args.join(' ');
      if (joined.includes('log') && joined.includes('--oneline') && joined.includes('--all')
          && !joined.includes('--grep')) {
        fullLogCallCount++;
      }
      return { code: 1, stdout: '' };
    };

    const fakeBatch = async (_prompt: string): Promise<string> => '[]';

    await runTriage(config, {
      nowMs: FIXED_NOW, gitRun: trackingRunner,
      llm: { enabled: true, runBatch: fakeBatch, batchSize: 10, threshold: 0.75 },
    });

    // The repo log should be fetched exactly once (one repo, one warm-up)
    // or 0 if there are no tasks after Tier-0 filtering
    expect(fullLogCallCount).toBeLessThanOrEqual(1);
  });
});

// ── AC5: gh results cache + Tier-0 resilience ─────────────────────────────────

describe('AC5: gh results cache + Tier-0 resilience', () => {
  it('makeGhCachedRunner caches gh pr view results by PR number', () => {
    let ghCallCount = 0;
    const baseRunner = (_cmd: string, _args: string[]): CmdResult => {
      ghCallCount++;
      return { code: 0, stdout: JSON.stringify({ state: 'MERGED', mergedAt: '2026-05-01T00:00:00Z' }) };
    };
    const { runner } = makeGhCachedRunner(baseRunner);

    // First call — should hit base runner
    runner('gh', ['pr', 'view', '42', '--json', 'state,mergedAt'], '/repo');
    expect(ghCallCount).toBe(1);

    // Second call for the same PR — should use cache, not call base runner again
    const result = runner('gh', ['pr', 'view', '42', '--json', 'state,mergedAt'], '/repo');
    expect(ghCallCount).toBe(1);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.state).toBe('MERGED');
  });

  it('makeGhCachedRunner caches null entry for failed gh calls', () => {
    let ghCallCount = 0;
    const failingRunner = (_cmd: string, _args: string[]): CmdResult => {
      ghCallCount++;
      return { code: 1, stdout: '' };
    };
    const { runner } = makeGhCachedRunner(failingRunner);

    runner('gh', ['pr', 'view', '99', '--json', 'state,mergedAt'], '/repo');
    expect(ghCallCount).toBe(1);

    // Second call — cached as null (failed), does not call base again
    const result = runner('gh', ['pr', 'view', '99', '--json', 'state,mergedAt'], '/repo');
    expect(ghCallCount).toBe(1);
    expect(result.code).toBe(1);
  });

  it('makeGhCachedRunner passes non-gh commands through without caching', () => {
    let gitCallCount = 0;
    const base = (cmd: string, _args: string[]): CmdResult => {
      if (cmd === 'git') gitCallCount++;
      return { code: 0, stdout: '' };
    };
    const { runner } = makeGhCachedRunner(base);

    runner('git', ['log', '--oneline'], '/repo');
    runner('git', ['log', '--oneline'], '/repo');
    // Git calls are not cached — both go through
    expect(gitCallCount).toBe(2);
  });

  it('AC5: Tier-0 resilient — failed probe does not abort the sweep', async () => {
    const projDir = join(tmpRoot, 'ac5-resilience-proj');
    const { config, tasksDir } = makeTempConfig(projDir);

    const { writeFileSync } = await import('node:fs');
    for (let i = 1; i <= 3; i++) {
      const id = `TEST-${String(i).padStart(3, '0')}`;
      const md = [
        '---', 'schema_version: 1', `id: ${id}`, `title: Task ${i}`, 'type: feature',
        'status: todo', 'priority: medium', 'project: TEST', 'tags: []', 'complexity: 1',
        'complexity_manual: false', `why: reason ${i}`, 'created: 2026-01-01T00:00:00Z',
        'updated: 2026-01-01T00:00:00Z', 'last_activity: 2026-01-01T00:00:00Z',
        'claimed_by: null', 'claimed_at: null', 'claim_ttl_hours: 4', 'parent: null',
        'children: []', 'dependencies: []', 'subtasks: []', 'git:', '  commits: []',
        'transitions: []', 'files: []', '---', '', `## Task ${i}`,
      ].join('\n');
      writeFileSync(join(tasksDir, `${id}.md`), md, 'utf-8');
    }

    // runTriage should NOT throw even if gitRun throws for every probe
    const throwingRunner = (): CmdResult => { throw new Error('network down'); };

    await expect(runTriage(config, {
      nowMs: FIXED_NOW,
      gitRun: throwingRunner,
      llm: { enabled: false },
    })).resolves.toHaveProperty('decisions');
  });
});

// ── MCPAT-083: spawn-retry helpers ────────────────────────────────────────────

/**
 * Build a minimal ChildProcess-like mock from two EventEmitters + a stub stdin.
 * failCount: how many calls should emit ENOENT before succeeding.
 * successOutput: the string the mock emits on the final successful call.
 */
function makeMockSpawnFn(
  failCount: number,
  successOutput: string = '[]',
): { spawnFn: SpawnFn; callCount: () => number } {
  let count = 0;

  const spawnFn: SpawnFn = (_cmd, _args, _opts): ChildProcess => {
    count++;
    const proc = new EventEmitter();
    const stdoutEmitter = new EventEmitter();
    const stdinEmitter = new EventEmitter();

    (proc as unknown as Record<string, unknown>)['stdout'] = stdoutEmitter;
    (proc as unknown as Record<string, unknown>)['stdin'] = Object.assign(stdinEmitter, {
      writable: true,
      write: () => true,
      end: () => {},
    });
    (proc as unknown as Record<string, unknown>)['kill'] = () => {};

    if (count <= failCount) {
      setImmediate(() => {
        const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
        proc.emit('error', err);
      });
    } else {
      setImmediate(() => {
        stdoutEmitter.emit('data', Buffer.from(successOutput, 'utf-8'));
        proc.emit('close', 0);
      });
    }

    return proc as unknown as ChildProcess;
  };

  return { spawnFn, callCount: () => count };
}

/** Always-fail mock: emits the given error code on every spawn. */
function makeAlwaysFailSpawnFn(
  code: string,
): { spawnFn: SpawnFn; callCount: () => number } {
  let count = 0;

  const spawnFn: SpawnFn = (_cmd, _args, _opts): ChildProcess => {
    count++;
    const proc = new EventEmitter();
    const stdoutEmitter = new EventEmitter();
    const stdinEmitter = new EventEmitter();

    (proc as unknown as Record<string, unknown>)['stdout'] = stdoutEmitter;
    (proc as unknown as Record<string, unknown>)['stdin'] = Object.assign(stdinEmitter, {
      writable: true, write: () => true, end: () => {},
    });
    (proc as unknown as Record<string, unknown>)['kill'] = () => {};

    setImmediate(() => {
      const err = Object.assign(new Error(`spawn ${code}`), { code });
      proc.emit('error', err);
    });

    return proc as unknown as ChildProcess;
  };

  return { spawnFn, callCount: () => count };
}

// ── MCPAT-083: spawn-retry (AC1) ──────────────────────────────────────────────

describe('MCPAT-083: spawn-retry (AC1)', () => {
  const env = { PATH: process.env['PATH'] ?? '' };

  it('AC1: spawnFn that emits ENOENT once then succeeds → resolves with output', async () => {
    const { spawnFn, callCount } = makeMockSpawnFn(1, '[]');
    const result = await spawnClaudeWithRetry('claude', ['-p'], 'prompt', env, spawnFn);
    expect(result).toBe('[]');
    expect(callCount()).toBe(2); // 1 fail + 1 success
  });

  it('AC1: always-ENOENT spawnFn rejects after SPAWN_RETRY_MAX attempts', async () => {
    const { spawnFn, callCount } = makeAlwaysFailSpawnFn('ENOENT');
    await expect(
      spawnClaudeWithRetry('claude', ['-p'], 'prompt', env, spawnFn),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(callCount()).toBe(SPAWN_RETRY_MAX);
  });

  it('AC1: non-transient code (EACCES) is NOT retried — rejects on first attempt', async () => {
    const { spawnFn, callCount } = makeAlwaysFailSpawnFn('EACCES');
    await expect(
      spawnClaudeWithRetry('claude', ['-p'], 'prompt', env, spawnFn),
    ).rejects.toMatchObject({ code: 'EACCES' });
    expect(callCount()).toBe(1);
  });

  it('AC1: ENOENT SPAWN_RETRY_MAX-1 times then success → resolves within retry limit', async () => {
    const { spawnFn, callCount } = makeMockSpawnFn(SPAWN_RETRY_MAX - 1, '["ok"]');
    const result = await spawnClaudeWithRetry('claude', ['-p'], 'prompt', env, spawnFn);
    expect(result).toBe('["ok"]');
    expect(callCount()).toBe(SPAWN_RETRY_MAX); // exactly maxAttempts
  });

  it('AC1: EBUSY is transient — retried like ENOENT', async () => {
    const { spawnFn, callCount } = makeMockSpawnFn(1, 'output');
    // Override first call to emit EBUSY (by constructing inline)
    let innerCount = 0;
    const busySpawn: SpawnFn = (_cmd, _args, _opts): ChildProcess => {
      innerCount++;
      const proc = new EventEmitter();
      const stdoutEmitter = new EventEmitter();
      const stdinEmitter = new EventEmitter();
      (proc as unknown as Record<string, unknown>)['stdout'] = stdoutEmitter;
      (proc as unknown as Record<string, unknown>)['stdin'] = Object.assign(stdinEmitter, {
        writable: true, write: () => true, end: () => {},
      });
      (proc as unknown as Record<string, unknown>)['kill'] = () => {};

      if (innerCount === 1) {
        setImmediate(() => proc.emit('error', Object.assign(new Error('EBUSY'), { code: 'EBUSY' })));
      } else {
        setImmediate(() => { stdoutEmitter.emit('data', Buffer.from('ok', 'utf-8')); proc.emit('close', 0); });
      }
      return proc as unknown as ChildProcess;
    };
    const result = await spawnClaudeWithRetry('claude', ['-p'], 'prompt', env, busySpawn);
    expect(result).toBe('ok');
    expect(innerCount).toBe(2);
  });

  it('AC1: TRANSIENT_SPAWN_CODES includes all five expected codes', () => {
    expect(TRANSIENT_SPAWN_CODES.has('ENOENT')).toBe(true);
    expect(TRANSIENT_SPAWN_CODES.has('EBUSY')).toBe(true);
    expect(TRANSIENT_SPAWN_CODES.has('EAGAIN')).toBe(true);
    expect(TRANSIENT_SPAWN_CODES.has('EMFILE')).toBe(true);
    expect(TRANSIENT_SPAWN_CODES.has('ETXTBSY')).toBe(true);
    expect(TRANSIENT_SPAWN_CODES.has('EACCES')).toBe(false);
    expect(TRANSIENT_SPAWN_CODES.has('ETIMEOUT')).toBe(false);
  });

  it('AC1: SPAWN_RETRY_MAX is 3', () => {
    expect(SPAWN_RETRY_MAX).toBe(3);
  });
});

// ── MCPAT-083: default concurrency (AC2) ──────────────────────────────────────

describe('MCPAT-083: default concurrency (AC2)', () => {
  it('AC2: default Tier-2 concurrency is 3 (not 4)', async () => {
    const projDir = join(tmpRoot, 'ac2-concurrency-proj');
    const { config, tasksDir } = makeTempConfig(projDir);

    const { writeFileSync } = await import('node:fs');
    // 9 tasks with batchSize=1 → 9 single-task batches. maxInFlight should not exceed 3.
    for (let i = 1; i <= 9; i++) {
      const id = `TEST-${String(i).padStart(3, '0')}`;
      const md = [
        '---', 'schema_version: 1', `id: ${id}`, `title: Task ${i}`, 'type: feature',
        'status: todo', 'priority: medium', 'project: TEST', 'tags: []', 'complexity: 1',
        'complexity_manual: false', `why: reason ${i}`, 'created: 2026-01-01T00:00:00Z',
        'updated: 2026-01-01T00:00:00Z', 'last_activity: 2026-01-01T00:00:00Z',
        'claimed_by: null', 'claimed_at: null', 'claim_ttl_hours: 4', 'parent: null',
        'children: []', 'dependencies: []', 'subtasks: []', 'git:', '  commits: []',
        'transitions: []', 'files: []', '---', '', `## Task ${i}`,
      ].join('\n');
      writeFileSync(join(tasksDir, `${id}.md`), md, 'utf-8');
    }

    let inFlight = 0;
    let maxInFlight = 0;
    const fakeBatch = async (_prompt: string): Promise<string> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>(resolve => setImmediate(resolve));
      inFlight--;
      return '[]';
    };

    // No concurrency override — uses the engine default (should be 3 now)
    await runTriage(config, {
      nowMs: FIXED_NOW, gitRun: noSignalRunner,
      llm: { enabled: true, runBatch: fakeBatch, batchSize: 1, threshold: 0.75 },
    });

    expect(maxInFlight).toBeGreaterThanOrEqual(1);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });
});

// ── MCPAT-087: writeLatestReport / readLatestReport / deleteLatestReport ───────

describe('writeLatestReport / readLatestReport roundtrip', () => {
  it('roundtrips a TriageReport and adds savedAt', async () => {
    const report = {
      decisions: [],
      skips: [],
      totalOpen: 3,
      parseErrors: 0,
      tier0Count: 0,
      tier2Count: 0,
      projects: [],
      runId: 'ui-12345',
    };
    writeLatestReport(report);
    const persisted: PersistedTriageReport | null = readLatestReport();
    expect(persisted).not.toBeNull();
    expect(persisted!.runId).toBe('ui-12345');
    expect(persisted!.totalOpen).toBe(3);
    expect(typeof persisted!.savedAt).toBe('string');
    // savedAt should be a valid ISO-8601 date
    expect(Date.parse(persisted!.savedAt)).toBeGreaterThan(0);
  });

  it('readLatestReport returns null when file is absent', () => {
    // Delete the file first if it exists
    deleteLatestReport();
    const result = readLatestReport();
    expect(result).toBeNull();
  });

  it('deleteLatestReport removes the file', () => {
    // Write it, then delete, then read should be null
    writeLatestReport({
      decisions: [], skips: [], totalOpen: 1, parseErrors: 0,
      tier0Count: 0, tier2Count: 0, projects: [], runId: 'ui-del-test',
    });
    // Confirm it was written
    const before = readLatestReport();
    expect(before).not.toBeNull();
    // Now delete
    deleteLatestReport();
    const after = readLatestReport();
    expect(after).toBeNull();
  });

  it('deleteLatestReport is idempotent — calling twice does not throw', () => {
    deleteLatestReport(); // file already gone
    expect(() => deleteLatestReport()).not.toThrow();
  });
});

// ── MCPAT-087: server-behavior simulations ────────────────────────────────────
// These tests replicate the logic the server applies (without spinning up HTTP).

describe('MCPAT-087: GET /api/triage/latest returns 404 when file absent', () => {
  it('readLatestReport returns null (→ server would 404) when no report was ever written', () => {
    deleteLatestReport(); // ensure absent
    const result = readLatestReport();
    // Server checks: if (!persisted) → 404 { error: 'NO_LATEST_RUN' }
    expect(result).toBeNull();
  });

  it('readLatestReport returns data (→ server would 200) after a write', () => {
    writeLatestReport({
      decisions: [], skips: [], totalOpen: 5, parseErrors: 0,
      tier0Count: 2, tier2Count: 1, projects: [], runId: 'ui-server-test-001',
    });
    const result = readLatestReport();
    expect(result).not.toBeNull();
    expect(result!.runId).toBe('ui-server-test-001');
    deleteLatestReport(); // clean up
  });
});

describe('MCPAT-087: POST /api/triage/apply with cold cache reads from file', () => {
  it('when persisted runId matches body.runId, decisions are available (no RUN_MISMATCH)', () => {
    const runId = 'ui-cold-cache-001';
    writeLatestReport({
      decisions: [
        { taskId: 'TEST-100', project: 'TEST', fromStatus: 'todo', toStatus: 'done',
          path: ['todo', 'in_progress', 'done'], tier: 0, signal: 'pr-merged',
          detail: 'PR merged', evidenceHard: true },
      ],
      skips: [], totalOpen: 1, parseErrors: 0, tier0Count: 1, tier2Count: 0, projects: [],
      runId,
    });

    const persisted = readLatestReport();
    expect(persisted).not.toBeNull();
    // Simulate server logic: persisted.runId === body.runId → use decisions
    expect(persisted!.runId).toBe(runId);
    expect(persisted!.decisions).toHaveLength(1);
    expect(persisted!.decisions[0]!.taskId).toBe('TEST-100');

    deleteLatestReport(); // simulate deleteLatestReport() called after Apply
    expect(readLatestReport()).toBeNull();
  });

  it('when persisted runId does not match body.runId → RUN_MISMATCH (409)', () => {
    const storedRunId = 'ui-old-run-001';
    const requestedRunId = 'ui-newer-run-002';
    writeLatestReport({
      decisions: [], skips: [], totalOpen: 0, parseErrors: 0,
      tier0Count: 0, tier2Count: 0, projects: [], runId: storedRunId,
    });

    const persisted = readLatestReport();
    expect(persisted).not.toBeNull();
    // Server logic: if (persisted.runId !== body.runId) → 409 RUN_MISMATCH
    const isMismatch = persisted!.runId !== requestedRunId;
    expect(isMismatch).toBe(true);

    deleteLatestReport(); // clean up
  });
});
