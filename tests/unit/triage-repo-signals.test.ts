/**
 * Unit tests for src/triage/repo-signals.ts (MCPAT-080 AC1–AC3).
 * No real git repo — all git commands are stubbed via the injected CmdRunner.
 */
import { describe, it, expect } from 'vitest';
import { extractKeywords, gatherRepoSignals, summarizeSignals } from '../../src/triage/repo-signals.js';
import type { RepoSignals } from '../../src/triage/repo-signals.js';
import type { CmdResult } from '../../src/triage/git-signals.js';
import type { Task } from '../../src/types/task.js';

// ---------- helpers ----------------------------------------------------------

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'MCPAT-080', title: 'Add JobDispatcher support', type: 'feature', status: 'in_progress',
    priority: 'medium', project: 'MCPAT', tags: [], complexity: 1, why: 'needed for triage',
    created: '2026-01-01T00:00:00Z', updated: '2026-03-01T00:00:00Z',
    last_activity: '2026-03-01T00:00:00Z', claimed_by: null, claimed_at: null,
    claim_ttl_hours: 4, transitions: [],
    git: { commits: [] }, body: '', file_path: '', scheduled_for: null,
    files: [],
    ...over,
  } as Task;
}

/** Silent runner — every command fails (code 1, empty stdout). */
const silentRunner = (): CmdResult => ({ code: 1, stdout: '' });

/** Runner factory: returns the provided output for any git call. */
function stubRunner(responses: Record<string, CmdResult>): (cmd: string, args: string[]) => CmdResult {
  return (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    // Match by substring of the key
    for (const [pattern, result] of Object.entries(responses)) {
      if (key.includes(pattern)) return result;
    }
    return { code: 1, stdout: '' };
  };
}

// ---------- extractKeywords --------------------------------------------------

describe('extractKeywords (AC1)', () => {
  it('extracts PascalCase identifier from title', () => {
    expect(extractKeywords('Add JobDispatcher support')).toContain('JobDispatcher');
  });

  it('extracts camelCase identifier', () => {
    const kw = extractKeywords('Implement taskView helper function');
    expect(kw.some(k => /taskView/i.test(k) || /helper/i.test(k))).toBe(true);
  });

  it('skips stopwords', () => {
    const kw = extractKeywords('Fix and update the data with this feature');
    expect(kw).not.toContain('with');
    expect(kw).not.toContain('this');
    expect(kw).not.toContain('and');
    expect(kw).not.toContain('the');
    expect(kw).not.toContain('data');
  });

  it('skips tokens ≤ 3 chars', () => {
    const kw = extractKeywords('Add API key to db');
    expect(kw.every(k => k.length > 3)).toBe(true);
  });

  it('respects cap of 3 keywords', () => {
    const kw = extractKeywords('Add UserRepository AuthService JobDispatcher EmailNotifier');
    expect(kw.length).toBeLessThanOrEqual(3);
  });

  it('prefers quoted strings', () => {
    const kw = extractKeywords('Add "SpecialLoader" support to codebase');
    expect(kw[0]).toBe('SpecialLoader');
  });

  it('deduplicates case-insensitively', () => {
    const kw = extractKeywords('Add jobdispatcher JobDispatcher JOBDISPATCHER');
    expect(kw.filter(k => k.toLowerCase() === 'jobdispatcher').length).toBe(1);
  });

  it('returns empty array for stopword-only title', () => {
    const kw = extractKeywords('fix and add the file');
    expect(kw.length).toBe(0);
  });

  it('returns empty array for empty title', () => {
    expect(extractKeywords('')).toEqual([]);
  });
});

// ---------- gatherRepoSignals ------------------------------------------------

describe('gatherRepoSignals (AC2)', () => {
  it('returns empty/zeroed signals when repoPath is null', () => {
    const s = gatherRepoSignals(task(), null, silentRunner);
    expect(s.filesTotal).toBe(0);
    expect(s.filesPresent).toBe(0);
    expect(s.idCommitCount).toBe(0);
    expect(s.idLastDate).toBeUndefined();
    expect(s.filesLastTouched).toBeUndefined();
    expect(s.keywordsFound).toEqual([]);
    expect(s.keywordsTried).toEqual([]);
  });

  it('never throws when commands fail', () => {
    const throwingRunner = (): CmdResult => { throw new Error('git crash'); };
    expect(() => gatherRepoSignals(task({ files: ['src/foo.ts'] }), '/repo', throwingRunner)).not.toThrow();
  });

  it('signal 1: counts present files via git ls-files', () => {
    const t = task({ files: ['src/a.ts', 'src/b.ts', 'src/missing.ts'] });
    const run = stubRunner({
      'ls-files -- src/a.ts': { code: 0, stdout: 'src/a.ts\n' },
      'ls-files -- src/b.ts': { code: 0, stdout: 'src/b.ts\n' },
      'ls-files -- src/missing.ts': { code: 1, stdout: '' },
    });
    const s = gatherRepoSignals(t, '/repo', run);
    expect(s.filesTotal).toBe(3);
    expect(s.filesPresent).toBe(2);
  });

  it('signal 2: counts commits matching task ID and captures last date', () => {
    const run = stubRunner({
      'log --oneline --all --grep=MCPAT-080 -i': { code: 0, stdout: 'abc123 feat: stuff\ndef456 fix: thing\n' },
      'log --all --format=%cs --grep=MCPAT-080 -1 -i': { code: 0, stdout: '2026-05-30\n' },
    });
    const s = gatherRepoSignals(task(), '/repo', run);
    expect(s.idCommitCount).toBe(2);
    expect(s.idLastDate).toBe('2026-05-30');
  });

  it('signal 2: idCommitCount is 0 when no matches', () => {
    const s = gatherRepoSignals(task(), '/repo', silentRunner);
    expect(s.idCommitCount).toBe(0);
    expect(s.idLastDate).toBeUndefined();
  });

  it('signal 3: captures most-recent touch date across files', () => {
    const t = task({ files: ['src/a.ts', 'src/b.ts'] });
    const run = stubRunner({
      'log -1 --format=%cs -- src/a.ts': { code: 0, stdout: '2026-05-20\n' },
      'log -1 --format=%cs -- src/b.ts': { code: 0, stdout: '2026-05-29\n' },
    });
    const s = gatherRepoSignals(t, '/repo', run);
    expect(s.filesLastTouched).toBe('2026-05-29');
  });

  it('signal 3: absent when no files listed', () => {
    const s = gatherRepoSignals(task({ files: [] }), '/repo', silentRunner);
    expect(s.filesLastTouched).toBeUndefined();
  });

  it('signal 4: records keywords found via git grep', () => {
    const t = task({ title: 'Add JobDispatcher support' });
    const run = stubRunner({
      'grep -l --max-count=1 JobDispatcher': { code: 0, stdout: 'src/dispatcher.ts\n' },
    });
    const s = gatherRepoSignals(t, '/repo', run);
    expect(s.keywordsFound).toContain('JobDispatcher');
    expect(s.keywordsTried).toContain('JobDispatcher');
  });

  it('signal 4: keywordsFound is empty when grep returns nothing', () => {
    const t = task({ title: 'Add JobDispatcher support' });
    const s = gatherRepoSignals(t, '/repo', silentRunner);
    expect(s.keywordsFound).toEqual([]);
    expect(s.keywordsTried).toContain('JobDispatcher');
  });

  it('caps files scanned at 10', () => {
    const manyFiles = Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`);
    const t = task({ files: manyFiles });
    let lsFilesCallCount = 0;
    const run = (): CmdResult => {
      lsFilesCallCount++;
      return { code: 0, stdout: 'x\n' };
    };
    const s = gatherRepoSignals(t, '/repo', run);
    // filesTotal is capped at 10; lsFiles calls ≤ 10 (plus other git calls)
    expect(s.filesTotal).toBe(10);
    expect(s.filesPresent).toBeLessThanOrEqual(10);
  });
});

// ---------- summarizeSignals -------------------------------------------------

describe('summarizeSignals (AC3)', () => {
  it('returns empty string for fully empty signals', () => {
    const s: RepoSignals = { filesTotal: 0, filesPresent: 0, idCommitCount: 0, keywordsFound: [], keywordsTried: [] };
    expect(summarizeSignals(s)).toBe('');
  });

  it('includes files present fraction when filesTotal > 0', () => {
    const s: RepoSignals = { filesTotal: 3, filesPresent: 2, idCommitCount: 0, keywordsFound: [], keywordsTried: [] };
    expect(summarizeSignals(s)).toContain('files 2/3 exist');
  });

  it('includes commit count and date when idCommitCount > 0', () => {
    const s: RepoSignals = { filesTotal: 0, filesPresent: 0, idCommitCount: 3, idLastDate: '2026-05-30', keywordsFound: [], keywordsTried: [] };
    const out = summarizeSignals(s);
    expect(out).toContain('id in 3 commits');
    expect(out).toContain('last 2026-05-30');
  });

  it('uses singular "commit" for idCommitCount=1', () => {
    const s: RepoSignals = { filesTotal: 0, filesPresent: 0, idCommitCount: 1, idLastDate: '2026-05-01', keywordsFound: [], keywordsTried: [] };
    expect(summarizeSignals(s)).toContain('id in 1 commit ');
    expect(summarizeSignals(s)).not.toContain('commits');
  });

  it('includes filesLastTouched when present', () => {
    const s: RepoSignals = { filesTotal: 0, filesPresent: 0, idCommitCount: 0, filesLastTouched: '2026-05-29', keywordsFound: [], keywordsTried: [] };
    expect(summarizeSignals(s)).toContain('touched 2026-05-29');
  });

  it('includes quoted keywords found in code', () => {
    const s: RepoSignals = { filesTotal: 0, filesPresent: 0, idCommitCount: 0, keywordsFound: ['JobDispatcher'], keywordsTried: ['JobDispatcher'] };
    expect(summarizeSignals(s)).toContain('"JobDispatcher" in code');
  });

  it('starts with pipe separator', () => {
    const s: RepoSignals = { filesTotal: 2, filesPresent: 2, idCommitCount: 0, keywordsFound: [], keywordsTried: [] };
    expect(summarizeSignals(s)).toMatch(/^\| /);
  });

  it('joins multiple parts with semicolons', () => {
    const s: RepoSignals = {
      filesTotal: 2, filesPresent: 2,
      idCommitCount: 3, idLastDate: '2026-05-30',
      filesLastTouched: '2026-05-29',
      keywordsFound: ['JobDispatcher'], keywordsTried: ['JobDispatcher'],
    };
    const out = summarizeSignals(s);
    expect(out).toContain('; ');
    expect(out).toMatch(/files.*id in.*touched.*in code/);
  });

  it('omits absent signals', () => {
    const s: RepoSignals = { filesTotal: 0, filesPresent: 0, idCommitCount: 5, keywordsFound: [], keywordsTried: [] };
    const out = summarizeSignals(s);
    expect(out).toContain('id in 5 commits');
    expect(out).not.toContain('files');
    expect(out).not.toContain('touched');
    expect(out).not.toContain('in code');
  });
});
