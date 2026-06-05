/**
 * Phase E tests for NoteStore — title/pinned fields and delete method.
 *
 * Uses SqliteIndex + NoteStore directly in a temp directory (no HTTP server needed).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { SqliteIndex } from '../../src/store/sqlite-index.js'
import { NoteStore } from '../../src/store/note-store.js'
import type { McpTasksConfig } from '../../src/config/loader.js'

function makeEnv(): { tempDir: string; sqliteIndex: SqliteIndex; noteStore: NoteStore } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-store-phase-e-'))
  const tasksDir = path.join(tempDir, 'agent-tasks')
  fs.mkdirSync(tasksDir, { recursive: true })

  const dbPath = path.join(tempDir, 'tasks.db')
  const sqliteIndex = new SqliteIndex(dbPath)
  sqliteIndex.init()

  const config: McpTasksConfig = {
    version: 1,
    storageDir: tasksDir,
    defaultStorage: 'local',
    enforcement: 'off',
    autoCommit: false,
    claimTtlHours: 4,
    trackManifest: false,
    tasksDirName: 'agent-tasks',
    projects: [{ prefix: 'GEN', path: tempDir, storage: 'local' }],
  }

  const noteStore = new NoteStore(sqliteIndex, config)
  return { tempDir, sqliteIndex, noteStore }
}

describe('NoteStore Phase E — title + pinned fields', () => {
  let tempDir: string
  let sqliteIndex: SqliteIndex
  let noteStore: NoteStore

  beforeEach(() => {
    const env = makeEnv()
    tempDir = env.tempDir
    sqliteIndex = env.sqliteIndex
    noteStore = env.noteStore
  })

  afterEach(() => {
    // Close the DB connection before removing the temp dir — on Windows an open
    // SQLite handle keeps tasks.db locked and rmSync throws EBUSY.
    try {
      sqliteIndex.close()
    } catch {
      // already closed / never opened — safe to ignore
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('NoteStore.create persists title and pinned fields', () => {
    const note = noteStore.create(
      { body: 'Some body text', title: 'Hello', pinned: true },
      'GEN',
    )
    expect(note.title).toBe('Hello')
    expect(note.pinned).toBe(true)

    // Verify round-trip through SQLite
    const fetched = sqliteIndex.getNote(note.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.title).toBe('Hello')
    expect(fetched!.pinned).toBe(true)
  })

  it('NoteStore.create works without title/pinned (backward compat)', () => {
    const note = noteStore.create({ body: 'Plain note' }, 'GEN')
    expect(note.title).toBeUndefined()
    expect(note.pinned).toBeUndefined()
  })

  it('NoteStore.delete removes note', () => {
    const note = noteStore.create({ body: 'To be deleted' }, 'GEN')
    const id = note.id

    // Verify it exists
    expect(sqliteIndex.getNote(id)).not.toBeNull()

    // Delete it
    noteStore.delete(id)

    // Should be gone from SQLite
    expect(sqliteIndex.getNote(id)).toBeNull()
  })

  it('NoteStore.delete throws NOTE_NOT_FOUND for unknown id', () => {
    let thrown: unknown
    try {
      noteStore.delete('GEN-N-999')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeDefined()
    // McpTasksError carries the code as a property, not in the message
    expect((thrown as { code?: string }).code).toBe('NOTE_NOT_FOUND')
  })
})
