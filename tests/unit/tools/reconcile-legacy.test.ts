import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import matter from 'gray-matter';

import {
  deriveSlug,
  humaniseSlug,
  extractTitle,
  extractWhy,
  inferType,
  inferPriority,
  inferStatus,
  buildInference,
} from '../../../src/lib/frontmatter-builder.js';

import {
  extractPrNumber,
  findMatchingBranch,
} from '../../../src/lib/git-inference.js';

import type { GitInferenceResult } from '../../../src/lib/git-inference.js';

import { reconcileLegacy } from '../../../src/tools/task-reconcile-legacy.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGit(overrides: Partial<GitInferenceResult> = {}): GitInferenceResult {
  return {
    branch: undefined,
    merged: false,
    mergeCommitSha: undefined,
    mergeCommitMessage: undefined,
    prNumber: undefined,
    firstCommitDate: undefined,
    lastCommitDate: undefined,
    ...overrides,
  };
}

// ── 1. deriveSlug / humaniseSlug ─────────────────────────────────────────────

describe('deriveSlug', () => {
  it('lowercases and strips non-slug characters', () => {
    expect(deriveSlug('/abs/scratchpads/Fix-Auth-Bug.md')).toBe('fix-auth-bug');
  });

  it('replaces underscores with hyphens', () => {
    expect(deriveSlug('/proj/scratchpads/some_feature_plan.md')).toBe('some-feature-plan');
  });

  it('trims leading and trailing hyphens', () => {
    expect(deriveSlug('/proj/scratchpads/--trim-me--.md')).toBe('trim-me');
  });
});

describe('humaniseSlug', () => {
  it('title-cases each word separated by hyphens', () => {
    expect(humaniseSlug('fix-auth-bug')).toBe('Fix Auth Bug');
  });

  it('handles single word', () => {
    expect(humaniseSlug('feature')).toBe('Feature');
  });

  it('handles empty string gracefully', () => {
    expect(humaniseSlug('')).toBe('');
  });
});

// ── 2. extractTitle ───────────────────────────────────────────────────────────

describe('extractTitle', () => {
  it('returns trimmed H1 content', () => {
    const body = '# My Feature Plan\n\nSome description here.';
    expect(extractTitle(body, 'my-feature-plan')).toBe('My Feature Plan');
  });

  it('falls back to humaniseSlug when no H1 present', () => {
    const body = 'Just some text without a heading.';
    expect(extractTitle(body, 'my-feature-plan')).toBe('My Feature Plan');
  });

  it('truncates at 200 chars', () => {
    const longTitle = 'A'.repeat(250);
    const body = `# ${longTitle}`;
    expect(extractTitle(body, 'slug').length).toBe(200);
  });

  it('ignores H2 and deeper headings for title', () => {
    const body = '## Section Heading\n\nSome text.';
    expect(extractTitle(body, 'my-slug')).toBe('My Slug');
  });
});

// ── 3. extractWhy ─────────────────────────────────────────────────────────────

describe('extractWhy', () => {
  it('returns first paragraph after H1', () => {
    const body = '# Title\n\nThis is the reason why this task exists.\n\nMore content.';
    const why = extractWhy(body);
    expect(why).toBe('This is the reason why this task exists.');
  });

  it('returns empty string when body is only headings', () => {
    const body = '# Title\n\n## Section\n\n### Subsection';
    expect(extractWhy(body)).toBe('');
  });

  it('truncates at 500 chars', () => {
    const longPara = 'Word '.repeat(200); // > 500 chars
    const body = `# Title\n\n${longPara}`;
    const why = extractWhy(body);
    expect(why.length).toBeLessThanOrEqual(500);
  });

  it('strips blockquote markers', () => {
    const body = '# Title\n\n> This is quoted context.';
    expect(extractWhy(body)).toBe('This is quoted context.');
  });

  it('returns empty string when first paragraph after H1 is all bold key-value metadata', () => {
    const body = '# Title\n\n**Type**: Feature (refactor + enhancement)  **Effort**: XL\n**Status**: In progress\n\nMore content below.';
    expect(extractWhy(body)).toBe('');
  });

  it('returns prose when a real prose paragraph follows metadata lines', () => {
    const body = '# Title\n\n**Type**: Feature\n\nThis is the actual reason this task exists and it is long enough.';
    const why = extractWhy(body);
    expect(why).toBe('This is the actual reason this task exists and it is long enough.');
  });
});

// ── 4. inferType ──────────────────────────────────────────────────────────────

describe('inferType', () => {
  it("'feature-xyz' → 'feature'", () => {
    expect(inferType('feature-xyz', 'Feature Xyz', 'feature-xyz.md')).toBe('feature');
  });

  it("'implement-auth' → 'feature'", () => {
    expect(inferType('implement-auth', 'Implement Auth', 'implement-auth.md')).toBe('feature');
  });

  it("'fix-login' → 'bug'", () => {
    expect(inferType('fix-login', 'Fix Login', 'fix-login.md')).toBe('bug');
  });

  it("'cleanup-deps' → 'chore'", () => {
    expect(inferType('cleanup-deps', 'Cleanup Deps', 'cleanup-deps.md')).toBe('chore');
  });

  it("title match for feature", () => {
    expect(inferType('phase-one', 'Phase One', 'phase-one.md')).toBe('feature');
  });

  it("'-spec' suffix → 'feature'", () => {
    expect(inferType('bootstrap-self-sufficiency-spec', 'Bootstrap Self-Sufficiency', 'bootstrap-self-sufficiency-spec.md')).toBe('feature');
  });

  it("'-plan' suffix → 'feature'", () => {
    expect(inferType('some-plan', 'Some Plan', 'some-plan.md')).toBe('feature');
  });
});

// ── 5. inferPriority ─────────────────────────────────────────────────────────

describe('inferPriority', () => {
  it("'hotfix-crash' → 'high'", () => {
    expect(inferPriority('hotfix-crash')).toBe('high');
  });

  it("'fix-login' → 'high'", () => {
    expect(inferPriority('fix-login')).toBe('high');
  });

  it("'add-tooltip' → 'medium'", () => {
    expect(inferPriority('add-tooltip')).toBe('medium');
  });

  it("'critical-security-patch' → 'high'", () => {
    expect(inferPriority('critical-security-patch')).toBe('high');
  });
});

// ── 6. inferStatus ────────────────────────────────────────────────────────────

describe('inferStatus', () => {
  const now = new Date('2024-06-01T00:00:00Z');
  const recentMtime = new Date('2024-05-20T00:00:00Z'); // within 30 days
  const oldMtime = new Date('2023-01-01T00:00:00Z');    // older than 30 days

  it('merged + branch → done, high confidence', () => {
    const git = makeGit({
      branch: 'feature/my-task',
      merged: true,
      mergeCommitSha: 'abc123',
    });
    const result = inferStatus(git, oldMtime, now);
    expect(result.status).toBe('done');
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('abc123');
  });

  it('merged via slug only (no branch) → done, medium confidence', () => {
    const git = makeGit({
      branch: undefined,
      merged: true,
      mergeCommitSha: 'def456',
    });
    const result = inferStatus(git, oldMtime, now);
    expect(result.status).toBe('done');
    expect(result.confidence).toBe('medium');
    expect(result.reason).toContain('def456');
  });

  it('branch exists, not merged → in_progress, medium', () => {
    const git = makeGit({ branch: 'feature/my-task', merged: false });
    const result = inferStatus(git, oldMtime, now);
    expect(result.status).toBe('in_progress');
    expect(result.confidence).toBe('medium');
  });

  it('no git, mtime within 30 days → in_progress, low', () => {
    const git = makeGit(); // no branch, no merge
    const result = inferStatus(git, recentMtime, now);
    expect(result.status).toBe('in_progress');
    expect(result.confidence).toBe('low');
  });

  it('no git, mtime old → todo, unknown', () => {
    const git = makeGit(); // fully empty git result
    const result = inferStatus(git, oldMtime, now);
    expect(result.status).toBe('todo');
    expect(result.confidence).toBe('unknown');
    expect(result.reason).toBe('no signal available');
  });

  it('short slug (< 10 chars) with no branch match → status is NOT done', () => {
    // The slug length guard in inferGitContext prevents findMergeCommitBySlug from
    // running for short slugs like 'handoff' (7 chars). The resulting git context
    // will have merged: false, so status must not be 'done'.
    const git = makeGit({ merged: false, mergeCommitSha: undefined }); // what the guard produces
    const result = inferStatus(git, oldMtime, now);
    expect(result.status).not.toBe('done');
  });
});

// ── 7. findMatchingBranch ─────────────────────────────────────────────────────

describe('findMatchingBranch', () => {
  it('exact match wins', () => {
    const branches = ['main', 'my-task', 'feature/my-task'];
    expect(findMatchingBranch('my-task', branches)).toBe('my-task');
  });

  it('feature/<slug> prefix match', () => {
    const branches = ['main', 'feature/my-task', 'develop'];
    expect(findMatchingBranch('my-task', branches)).toBe('feature/my-task');
  });

  it('feat/<slug> prefix match', () => {
    const branches = ['main', 'feat/add-auth', 'develop'];
    expect(findMatchingBranch('add-auth', branches)).toBe('feat/add-auth');
  });

  it('fix/<slug> prefix match', () => {
    const branches = ['main', 'fix/login-crash'];
    expect(findMatchingBranch('login-crash', branches)).toBe('fix/login-crash');
  });

  it('LCS fallback at 70% threshold — positive case', () => {
    // slug = 'brain-phase-0-plan' (18 chars), threshold = ceil(18*0.7) = 13
    // branch 'feature/brain-phase-0' has LCS 'brain-phase-0' = 13 chars — passes
    const branches = ['main', 'feature/brain-phase-0'];
    const result = findMatchingBranch('brain-phase-0-plan', branches);
    expect(result).toBe('feature/brain-phase-0');
  });

  it('LCS fallback — rejects partial prefix match below 70% threshold', () => {
    // slug = 'mer-phase-4-plan' (16 chars), threshold = ceil(16*0.7) = 12
    // branch 'feature/mer-phase-1' has LCS 'mer-phase-' = 10 chars — rejected
    const branches = ['main', 'feature/mer-phase-1'];
    expect(findMatchingBranch('mer-phase-4-plan', branches)).toBeUndefined();
  });

  it('LCS fallback — skips short slugs below 12 chars', () => {
    // slug = 'reconcile' (9 chars) — below minimum, LCS skipped entirely
    const branches = ['main', 'reconcile-legacy-feature'];
    expect(findMatchingBranch('reconcile', branches)).toBeUndefined();
  });

  it('returns undefined when no branches', () => {
    expect(findMatchingBranch('my-task', [])).toBeUndefined();
  });
});

// ── 8. extractPrNumber ────────────────────────────────────────────────────────

describe('extractPrNumber', () => {
  it('extracts number from standard merge message', () => {
    expect(extractPrNumber('Merge feature-x (#123)')).toBe(123);
  });

  it('returns undefined when no PR number', () => {
    expect(extractPrNumber('no pr here')).toBeUndefined();
  });

  it('handles multi-digit PR numbers', () => {
    expect(extractPrNumber('Merge pull request (#4567) from feature/thing')).toBe(4567);
  });
});

// ── 9. buildInference smoke test ─────────────────────────────────────────────

describe('buildInference', () => {
  it('produces complete frontmatter with expected fields', () => {
    const now = new Date('2024-06-01T00:00:00Z');
    const mtime = new Date('2024-05-15T12:00:00Z');
    const birthtime = new Date('2024-05-01T00:00:00Z');

    const git = makeGit({
      branch: 'feature/implement-auth',
      merged: true,
      mergeCommitSha: 'deadbeef',
      prNumber: 42,
      firstCommitDate: '2024-05-02T00:00:00.000Z',
      lastCommitDate: '2024-05-14T00:00:00.000Z',
    });

    const result = buildInference({
      filePath: '/proj/scratchpads/implement-auth.md',
      fileContent: '# Implement Authentication\n\nWe need auth to secure the API.\n\nMore details here.',
      id: 'PROJ-001',
      project: 'PROJ',
      git,
      fallbackMtime: mtime,
      fallbackBirthtime: birthtime,
      now,
    });

    expect(result.frontmatter.schema_version).toBe(1);
    expect(result.frontmatter.id).toBe('PROJ-001');
    expect(result.frontmatter.title).toBe('Implement Authentication');
    expect(result.frontmatter.status).toBe('done');
    expect(result.frontmatter.type).toBe('feature');
    expect(result.frontmatter.project).toBe('PROJ');
    expect(result.frontmatter.created).toBe('2024-05-02T00:00:00.000Z');
    expect(result.frontmatter.updated).toBe('2024-05-14T00:00:00.000Z');
    expect(result.frontmatter.git.pr?.number).toBe(42);
    expect(result.confidence).toBe('high');
  });

  it('low-confidence item gets needs_review tag', () => {
    const now = new Date('2024-06-01T00:00:00Z');
    // mtime within 30 days → low confidence
    const mtime = new Date('2024-05-20T00:00:00Z');
    const birthtime = new Date('2024-05-01T00:00:00Z');

    const result = buildInference({
      filePath: '/proj/scratchpads/some-chore.md',
      fileContent: '# Some Chore\n\nReason for doing this chore right here.',
      id: 'PROJ-010',
      project: 'PROJ',
      git: makeGit(), // no branch, no merge → falls to mtime heuristic
      fallbackMtime: mtime,
      fallbackBirthtime: birthtime,
      now,
    });

    expect(result.confidence).toBe('low');
    expect(result.frontmatter.tags).toContain('needs_review');
  });

  it('round-trips through gray-matter with schema_version === 1', () => {
    const yaml = require('yaml');
    const now = new Date('2024-06-01T00:00:00Z');
    const mtime = new Date('2023-01-01T00:00:00Z');
    const birthtime = new Date('2023-01-01T00:00:00Z');

    const result = buildInference({
      filePath: '/proj/scratchpads/some-task.md',
      fileContent: '# Some Task\n\nThe reason for this task.',
      id: 'PROJ-002',
      project: 'PROJ',
      git: makeGit(),
      fallbackMtime: mtime,
      fallbackBirthtime: birthtime,
      now,
    });

    const yamlStr = yaml.stringify(result.frontmatter);
    const composed = `---\n${yamlStr}---\n\n${result.bodyPreview}\n`;
    const parsed = matter(composed);

    expect(parsed.data['schema_version']).toBe(1);
    expect(parsed.data['id']).toBe('PROJ-002');
    expect(parsed.data['title']).toBe('Some Task');
    expect(parsed.data['status']).toBe('todo');
    expect(Array.isArray(parsed.data['tags'])).toBe(true);
    // unknown confidence → needs_review tag
    expect((parsed.data['tags'] as string[])).toContain('needs_review');
  });
});

// ── 10. reconcileLegacy integration ──────────────────────────────────────────

describe('reconcileLegacy integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createScratchpad(name: string, content: string): void {
    const scratchpadsDir = path.join(tmpDir, 'scratchpads');
    fs.mkdirSync(scratchpadsDir, { recursive: true });
    fs.writeFileSync(path.join(scratchpadsDir, name), content, 'utf-8');
  }

  it('dry-run: no files written, summary has correct count', async () => {
    createScratchpad('foo.md', '# Foo Task\n\nReason for foo.');
    createScratchpad('bar.md', '# Bar Task\n\nReason for bar.');

    const summary = await reconcileLegacy({ projectPath: tmpDir, dryRun: true });

    expect(summary.scanned).toBe(2);
    expect(summary.written).toBe(0);
    expect(summary.dryRun).toBe(true);
    expect(summary.results).toHaveLength(2);
    // No tasks dir was created
    expect(fs.existsSync(path.join(tmpDir, 'agent-tasks'))).toBe(false);
  });

  it('writes 2 task files with valid frontmatter', async () => {
    createScratchpad('foo.md', '# Foo Feature\n\nWhy foo exists.');
    createScratchpad('bar.md', '# Bar Fix\n\nWhy bar exists.');

    const summary = await reconcileLegacy({ projectPath: tmpDir, dryRun: false, idPrefix: 'TEST' });

    expect(summary.written).toBe(2);
    expect(summary.skipped).toBe(0);

    const tasksDir = path.join(tmpDir, 'agent-tasks');
    const taskFiles = fs.readdirSync(tasksDir);
    expect(taskFiles).toHaveLength(2);

    for (const taskFile of taskFiles) {
      const content = fs.readFileSync(path.join(tasksDir, taskFile), 'utf-8');
      expect(content.startsWith('---')).toBe(true);
      const parsed = matter(content);
      expect(parsed.data['schema_version']).toBe(1);
      expect(typeof parsed.data['id']).toBe('string');
      expect(typeof parsed.data['title']).toBe('string');
      expect(typeof parsed.data['status']).toBe('string');
    }
  });

  it('second invocation skips already-written files', async () => {
    createScratchpad('foo.md', '# Foo Task\n\nFoo reason.');

    // First run
    await reconcileLegacy({ projectPath: tmpDir, dryRun: false, idPrefix: 'TEST' });

    // Second run on same project
    const summary2 = await reconcileLegacy({ projectPath: tmpDir, dryRun: false, idPrefix: 'TEST' });

    // The file already exists, so it should be skipped
    expect(summary2.results[0]?.error).toBe('output file already exists');
    expect(summary2.written).toBe(0);
    expect(summary2.skipped).toBe(1);
  });

  it('returns scanned: 0 and does not throw when scratchpads dir missing', async () => {
    // tmpDir has no scratchpads subdir
    const summary = await reconcileLegacy({ projectPath: tmpDir, dryRun: false });

    expect(summary.scanned).toBe(0);
    expect(summary.results).toHaveLength(0);
    expect(summary.written).toBe(0);
  });

  it('skips files that already have schema_version in frontmatter', async () => {
    createScratchpad(
      'legacy.md',
      '# Legacy\n\nOld file without schema_version.',
    );
    createScratchpad(
      'modern.md',
      '---\nschema_version: 1\nid: TEST-001\n---\n\n# Modern task',
    );

    const summary = await reconcileLegacy({ projectPath: tmpDir, dryRun: true, idPrefix: 'TEST' });

    // Only the legacy file should be scanned
    expect(summary.scanned).toBe(1);
    expect(summary.results[0]?.file).toBe('legacy.md');
  });
});
