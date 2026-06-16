/**
 * Integration test: note_create → note body is immediately searchable via note_search.
 *
 * Covers the AC: "Integration test: note_create → brain sync fires → note body appears
 * in note_search results."
 *
 * Brain sync is currently a no-op (no write tool in the brain MCP yet), so we verify
 * the local NoteStore FTS path: after create, the note must appear in search results.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { NoteStore } from '../../src/store/note-store.js';
import { syncNoteToBrain } from '../../src/lib/brain-sync.js';
import type { GlobalConfig } from '../../src/types/config.js';

function makeConfig(projectPath: string): GlobalConfig {
  return {
    version: 1,
    storageDir: projectPath,
    defaultStorage: 'local',
    enforcement: 'off',
    autoCommit: false,
    claimTtlHours: 4,
    trackManifest: false,
    tasksDirName: 'agent-tasks',
    projects: [{ prefix: 'TEST', path: projectPath, storage: 'local' }],
  };
}

describe('note_create → note body searchable via note_search', () => {
  let tmpDir: string;
  let idx: SqliteIndex;
  let store: NoteStore;
  let cfg: GlobalConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-search-int-'));
    const dbPath = path.join(tmpDir, 'tasks.db');
    idx = new SqliteIndex(dbPath);
    idx.init();
    cfg = makeConfig(tmpDir);
    store = new NoteStore(idx, cfg);
  });

  afterEach(() => {
    try { idx.close(); } catch { /* ok */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('created note body is findable via full-text search', () => {
    const note = store.create(
      { body: 'The roadmap for Q3 should prioritise the brain integration milestone', project: 'TEST' },
      'TEST',
    );
    expect(note.id).toMatch(/^TEST-N-\d{3}$/);

    // Verify note appears in FTS search with a term from its body
    const results = store.search('brain integration');
    expect(results.some(r => r.id === note.id)).toBe(true);
  });

  it('note_search excludes notes from other projects when project filter is applied', () => {
    store.create({ body: 'Alpha project strategy notes', project: 'TEST' }, 'TEST');

    // A second NoteStore instance simulating a different project that shares the index
    const store2 = new NoteStore(idx, makeConfig(tmpDir));
    const results = store2.search('strategy', 'OTHER');
    // No notes with project OTHER should appear
    expect(results.every(r => r.project === 'OTHER')).toBe(true);
  });

  it('syncNoteToBrain is called without error (no-op while brain write tool is absent)', () => {
    const note = store.create({ body: 'Thought about the new advisor feature', project: 'TEST' }, 'TEST');
    // syncNoteToBrain must not throw even with BRAIN_NOTE_SYNC unset
    expect(() => syncNoteToBrain(note, idx)).not.toThrow();
  });

  it('note body appears in search after update', () => {
    const note = store.create({ body: 'initial content only', project: 'TEST' }, 'TEST');
    store.update(note.id, { body: 'updated with quantum computing reference' });

    const results = store.search('quantum computing');
    expect(results.some(r => r.id === note.id)).toBe(true);
  });
});
