import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScheduledGithubReconcile } from '../../src/health/github-reconcile-scheduler.js';
import type { GithubReconcileSchedulerDeps } from '../../src/health/github-reconcile-scheduler.js';

describe('runScheduledGithubReconcile', () => {
  let tmpDir: string;
  let stampPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-scheduler-'));
    stampPath = path.join(tmpDir, 'last-run');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeGitProject(name: string): string {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    return dir;
  }

  function makeNonGitProject(name: string): string {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  it('first run executes for git-bearing projects, writes the stamp, and appends one metric event', async () => {
    const projectPath = makeGitProject('proj-a');
    const reconcile = vi.fn().mockResolvedValue({ scanned: 2, reconciled: 1, noSignal: 1 });
    const appendEvent = vi.fn();

    const deps: GithubReconcileSchedulerDeps = {
      projects: [{ prefix: 'PROJA', path: projectPath }],
      reconcile,
      appendEvent,
      stampPath,
    };

    const result = await runScheduledGithubReconcile(deps);

    expect(result).toEqual({ ran: true, projects: 1, reconciled: 1 });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith({ projectPath, idPrefix: 'PROJA' });
    expect(fs.existsSync(stampPath)).toBe(true);
    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'daemon:mcp-agent-tasks', kind: 'metric', detail: expect.objectContaining({ event: 'github-reconcile', projects: 1, scanned: 2, reconciled: 1 }) }),
    );
  });

  it('an immediate second run returns ran: false and calls reconcile zero times', async () => {
    const projectPath = makeGitProject('proj-b');
    const reconcile = vi.fn().mockResolvedValue({ scanned: 0, reconciled: 0, noSignal: 0 });
    const appendEvent = vi.fn();
    const deps: GithubReconcileSchedulerDeps = {
      projects: [{ prefix: 'PROJB', path: projectPath }],
      reconcile,
      appendEvent,
      stampPath,
    };

    await runScheduledGithubReconcile(deps);
    reconcile.mockClear();
    appendEvent.mockClear();

    const second = await runScheduledGithubReconcile(deps);

    expect(second).toEqual({ ran: false, projects: 0, reconciled: 0 });
    expect(reconcile).toHaveBeenCalledTimes(0);
    expect(appendEvent).toHaveBeenCalledTimes(0);
  });

  it('one project rejecting does not prevent the next project and appends an error event', async () => {
    const failingProject = makeGitProject('proj-fail');
    const okProject = makeGitProject('proj-ok');
    const reconcile = vi.fn().mockImplementation(async (opts: { idPrefix: string }) => {
      if (opts.idPrefix === 'FAIL') throw new Error('gh unauthenticated');
      return { scanned: 1, reconciled: 1, noSignal: 0 };
    });
    const appendEvent = vi.fn();
    const deps: GithubReconcileSchedulerDeps = {
      projects: [
        { prefix: 'FAIL', path: failingProject },
        { prefix: 'OK', path: okProject },
      ],
      reconcile,
      appendEvent,
      stampPath,
    };

    const result = await runScheduledGithubReconcile(deps);

    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ran: true, projects: 2, reconciled: 1 });
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', detail: expect.objectContaining({ event: 'github-reconcile', prefix: 'FAIL', message: 'gh unauthenticated' }) }),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'metric', detail: expect.objectContaining({ projects: 2, scanned: 1, reconciled: 1 }) }),
    );
  });

  it('a project dir without .git is skipped', async () => {
    const nonGitProject = makeNonGitProject('proj-nogit');
    const reconcile = vi.fn().mockResolvedValue({ scanned: 0, reconciled: 0, noSignal: 0 });
    const appendEvent = vi.fn();
    const deps: GithubReconcileSchedulerDeps = {
      projects: [{ prefix: 'NOGIT', path: nonGitProject }],
      reconcile,
      appendEvent,
      stampPath,
    };

    const result = await runScheduledGithubReconcile(deps);

    expect(reconcile).toHaveBeenCalledTimes(0);
    expect(result).toEqual({ ran: true, projects: 0, reconciled: 0 });
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'metric', detail: expect.objectContaining({ projects: 0 }) }),
    );
  });
});
