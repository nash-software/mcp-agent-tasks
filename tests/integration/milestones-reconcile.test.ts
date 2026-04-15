import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { MilestoneRepository } from '../../src/store/milestone-repository.js';
import { Reconciler } from '../../src/store/reconciler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const MILESTONES_FIXTURE = path.join(FIXTURES_DIR, 'milestones.yaml');

const PROJECT = 'TEST';

describe('Reconciler reads milestones.yaml', () => {
  let tempDir: string;
  let tasksDir: string;
  let sqliteIndex: SqliteIndex;
  let milestoneRepo: MilestoneRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-milestone-reconcile-'));
    tasksDir = path.join(tempDir, 'agent-tasks');
    fs.mkdirSync(tasksDir, { recursive: true });

    const dbPath = path.join(tempDir, 'tasks.db');
    sqliteIndex = new SqliteIndex(dbPath);
    sqliteIndex.init();
    milestoneRepo = new MilestoneRepository(sqliteIndex.getRawDb());
  });

  afterEach(() => {
    sqliteIndex.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reconciles milestones.yaml fixture and inserts 2 rows', () => {
    // Copy the fixture milestones.yaml into tasksDir
    fs.copyFileSync(MILESTONES_FIXTURE, path.join(tasksDir, 'milestones.yaml'));

    const reconciler = new Reconciler(sqliteIndex, tasksDir, PROJECT, milestoneRepo);
    reconciler.reconcile();

    const milestones = milestoneRepo.listMilestones(PROJECT);
    expect(milestones.length).toBe(2);

    const ids = milestones.map(m => m.id).sort();
    expect(ids).toEqual(['v1.0', 'v2.0']);

    const v1 = milestones.find(m => m.id === 'v1.0');
    expect(v1?.status).toBe('closed');
    expect(v1?.title).toBe('v1.0 Release');

    const v2 = milestones.find(m => m.id === 'v2.0');
    expect(v2?.status).toBe('open');
  });

  it('reconcile is idempotent — running twice does not duplicate rows', () => {
    fs.copyFileSync(MILESTONES_FIXTURE, path.join(tasksDir, 'milestones.yaml'));

    const reconciler = new Reconciler(sqliteIndex, tasksDir, PROJECT, milestoneRepo);
    reconciler.reconcile();
    reconciler.reconcile();

    const milestones = milestoneRepo.listMilestones(PROJECT);
    expect(milestones.length).toBe(2);
  });

  it('malformed YAML does not throw — reconcile returns 0 tasks', () => {
    fs.writeFileSync(path.join(tasksDir, 'milestones.yaml'), '{{{{not valid yaml: [', 'utf-8');

    const reconciler = new Reconciler(sqliteIndex, tasksDir, PROJECT, milestoneRepo);
    // Should not throw
    expect(() => reconciler.reconcile()).not.toThrow();

    const milestones = milestoneRepo.listMilestones(PROJECT);
    expect(milestones.length).toBe(0);
  });

  it('missing milestones.yaml is silently skipped', () => {
    // No milestones.yaml in tasksDir
    const reconciler = new Reconciler(sqliteIndex, tasksDir, PROJECT, milestoneRepo);
    expect(() => reconciler.reconcile()).not.toThrow();
    expect(milestoneRepo.listMilestones(PROJECT).length).toBe(0);
  });
});
