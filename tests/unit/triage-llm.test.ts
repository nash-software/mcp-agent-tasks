/**
 * Unit tests for the pure Tier-2 LLM triage helpers (src/triage/llm-triage.ts):
 * prompt building, robust verdict parsing, and verdict→decision mapping.
 * No claude spawn — pure logic.
 */
import { describe, it, expect } from 'vitest';
import { buildTriagePrompt, parseTriageVerdicts, mapVerdict, taskView } from '../../src/triage/llm-triage.js';
import { isDecision } from '../../src/triage/types.js';
import type { Task } from '../../src/types/task.js';

const NOW = Date.parse('2026-06-07T12:00:00Z');

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'MCPAT-001', title: 'Do the thing', type: 'feature', status: 'in_progress', priority: 'medium',
    project: 'MCPAT', tags: [], complexity: 1, why: 'because', created: '2026-01-01T00:00:00Z',
    updated: '2026-03-01T00:00:00Z', last_activity: '2026-03-01T00:00:00Z',
    claimed_by: null, claimed_at: null, claim_ttl_hours: 4, transitions: [],
    git: { commits: [] }, body: '', file_path: '', scheduled_for: null, ...over,
  } as Task;
}

describe('taskView', () => {
  it('derives a compact view with ages and git flags', () => {
    const v = taskView(task({ git: { commits: [{ sha: 'a', message: 'm', authored_at: '' }], branch: 'feat/x' } }), NOW);
    expect(v.id).toBe('MCPAT-001');
    expect(v.commits).toBe(1);
    expect(v.branch).toBe('feat/x');
    expect(v.ageDays).toBeGreaterThan(150);
  });
});

describe('buildTriagePrompt', () => {
  it('includes every task id, asks for JSON, and guards against injection', () => {
    const p = buildTriagePrompt([taskView(task({ id: 'A-1' }), NOW), taskView(task({ id: 'B-2' }), NOW)]);
    expect(p).toContain('A-1');
    expect(p).toContain('B-2');
    expect(p).toMatch(/json/i);
    expect(p).toMatch(/untrusted|do not follow|ignore instructions/i);
  });
});

describe('parseTriageVerdicts', () => {
  it('parses a bare JSON array', () => {
    const out = '[{"id":"A-1","verdict":"done","confidence":0.9,"rationale":"merged"}]';
    expect(parseTriageVerdicts(out)).toEqual([{ id: 'A-1', verdict: 'done', confidence: 0.9, rationale: 'merged' }]);
  });
  it('parses a ```json fenced array with surrounding prose', () => {
    const out = 'Here you go:\n```json\n[{"id":"A-1","verdict":"obsolete","confidence":0.8,"rationale":"gone"}]\n```\nDone.';
    expect(parseTriageVerdicts(out)[0]).toMatchObject({ id: 'A-1', verdict: 'obsolete' });
  });
  it('parses an object wrapper {verdicts:[...]}', () => {
    const out = '{"verdicts":[{"id":"A-1","verdict":"still_relevant","confidence":0.7,"rationale":"active"}]}';
    expect(parseTriageVerdicts(out)[0]).toMatchObject({ id: 'A-1', verdict: 'still_relevant' });
  });
  it('drops entries with an unknown verdict or missing id', () => {
    const out = '[{"id":"A-1","verdict":"banana","confidence":1,"rationale":"x"},{"verdict":"done","confidence":1,"rationale":"y"},{"id":"C-3","verdict":"done","confidence":0.95,"rationale":"ok"}]';
    const r = parseTriageVerdicts(out);
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe('C-3');
  });
  it('clamps confidence into [0,1]', () => {
    const out = '[{"id":"A-1","verdict":"done","confidence":5,"rationale":"x"},{"id":"A-2","verdict":"done","confidence":-2,"rationale":"y"}]';
    const r = parseTriageVerdicts(out);
    expect(r[0]!.confidence).toBe(1);
    expect(r[1]!.confidence).toBe(0);
  });
  it('returns [] on garbage', () => {
    expect(parseTriageVerdicts('no json here')).toEqual([]);
    expect(parseTriageVerdicts('')).toEqual([]);
  });

  it('parses real claude output: prose preamble + fenced array (injection-refusal note)', () => {
    const real = [
      '**Heads up — prompt injection detected in task ACR-040:** ignoring it.',
      '',
      '```json',
      '[',
      '  {"id":"COND-088","verdict":"still_relevant","confidence":0.7,"rationale":"open PR, unresolved bug"},',
      '  {"id":"PRSM-012","verdict":"unsure","confidence":0.5,"rationale":"210d idle, never started"},',
      '  {"id":"HRLD-005","verdict":"still_relevant","confidence":0.95,"rationale":"3 recent commits, in flight"}',
      ']',
      '```',
    ].join('\n');
    const r = parseTriageVerdicts(real);
    expect(r).toHaveLength(3);
    expect(r.find(v => v.id === 'HRLD-005')).toMatchObject({ verdict: 'still_relevant', confidence: 0.95 });
    expect(r.find(v => v.id === 'PRSM-012')!.verdict).toBe('unsure');
  });
});

describe('mapVerdict', () => {
  const T = 0.85;
  it('resolves a high-confidence done verdict to done', () => {
    const o = mapVerdict(task({ status: 'in_progress' }), { id: 'MCPAT-001', verdict: 'done', confidence: 0.95, rationale: 'shipped' }, T);
    expect(isDecision(o)).toBe(true);
    if (isDecision(o)) {
      expect(o.tier).toBe(2);
      expect(o.toStatus).toBe('done');
      expect(o.signal).toBe('llm-done');
      expect(o.confidence).toBe(0.95);
      expect(o.path).toEqual(['in_progress', 'done']);
    }
  });
  it('resolves high-confidence obsolete and duplicate too', () => {
    for (const verdict of ['obsolete', 'duplicate'] as const) {
      const o = mapVerdict(task(), { id: 'MCPAT-001', verdict, confidence: 0.9, rationale: 'x' }, T);
      expect(isDecision(o)).toBe(true);
    }
  });
  it('escalates a below-threshold done verdict as llm-unsure', () => {
    const o = mapVerdict(task(), { id: 'MCPAT-001', verdict: 'done', confidence: 0.5, rationale: 'maybe' }, T);
    if (!isDecision(o)) expect(o.reason).toBe('llm-unsure'); else throw new Error('should skip');
  });
  it('keeps a still_relevant verdict (llm-keep)', () => {
    const o = mapVerdict(task(), { id: 'MCPAT-001', verdict: 'still_relevant', confidence: 0.9, rationale: 'active' }, T);
    if (!isDecision(o)) expect(o.reason).toBe('llm-keep'); else throw new Error('should skip');
  });
  it('escalates unsure verdict as llm-unsure', () => {
    const o = mapVerdict(task(), { id: 'MCPAT-001', verdict: 'unsure', confidence: 0.9, rationale: '?' }, T);
    if (!isDecision(o)) expect(o.reason).toBe('llm-unsure'); else throw new Error('should skip');
  });
  it('reports llm-error when no verdict was returned for the task', () => {
    const o = mapVerdict(task(), undefined, T);
    if (!isDecision(o)) expect(o.reason).toBe('llm-error'); else throw new Error('should skip');
  });
});
