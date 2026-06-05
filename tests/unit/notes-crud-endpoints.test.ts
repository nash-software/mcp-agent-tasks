/**
 * Phase E MCPAT-070 — Notes CRUD endpoints
 * POST /api/notes   — create note (title required)
 * DELETE /api/notes/:id — delete note
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js'

function makeTempEnv(): { tempDir: string; configPath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-crud-test-'))
  const tasksDir = path.join(tempDir, 'agent-tasks')
  fs.mkdirSync(tasksDir, { recursive: true })
  const configPath = path.join(tempDir, 'config.json')
  fs.writeFileSync(configPath, JSON.stringify({
    version: 1,
    storageDir: tasksDir,
    defaultStorage: 'local',
    enforcement: 'off',
    autoCommit: false,
    claimTtlHours: 4,
    trackManifest: false,
    tasksDirName: 'agent-tasks',
    projects: [{ prefix: 'GEN', path: tempDir, storage: 'local' }],
  }), 'utf-8')
  return { tempDir, configPath }
}

describe('POST /api/notes (Phase E)', () => {
  let handle: UiServerHandle
  let baseUrl: string
  let tempDir: string
  let savedConfig: string | undefined
  let savedDb: string | undefined

  beforeAll(async () => {
    const env = makeTempEnv()
    tempDir = env.tempDir
    savedConfig = process.env['MCP_TASKS_CONFIG']
    savedDb = process.env['MCP_TASKS_DB']
    process.env['MCP_TASKS_CONFIG'] = env.configPath
    process.env['MCP_TASKS_DB'] = path.join(tempDir, 'tasks.db')
    handle = await startUiServer({ port: 0 })
    baseUrl = handle.url
  })

  afterAll(async () => {
    await handle.close()
    if (savedConfig === undefined) delete process.env['MCP_TASKS_CONFIG']
    else process.env['MCP_TASKS_CONFIG'] = savedConfig
    if (savedDb === undefined) delete process.env['MCP_TASKS_DB']
    else process.env['MCP_TASKS_DB'] = savedDb
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns 400 when title is missing', async () => {
    const res = await fetch(`${baseUrl}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'no title here' }),
    })
    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('TITLE_REQUIRED')
  })

  it('creates a note and returns 201 with NoteRecord', async () => {
    const res = await fetch(`${baseUrl}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test note', body: 'some body text' }),
    })
    expect(res.status).toBe(201)
    const data = await res.json() as { id: string; title: string; body: string }
    expect(data.title).toBe('Test note')
    expect(data.body).toBe('some body text')
    expect(data.id).toMatch(/^GEN-N-/)
  })
})

describe('DELETE /api/notes/:id (Phase E)', () => {
  let handle: UiServerHandle
  let baseUrl: string
  let tempDir: string
  let savedConfig: string | undefined
  let savedDb: string | undefined

  beforeAll(async () => {
    const env = makeTempEnv()
    tempDir = env.tempDir
    savedConfig = process.env['MCP_TASKS_CONFIG']
    savedDb = process.env['MCP_TASKS_DB']
    process.env['MCP_TASKS_CONFIG'] = env.configPath
    process.env['MCP_TASKS_DB'] = path.join(tempDir, 'tasks.db')
    handle = await startUiServer({ port: 0 })
    baseUrl = handle.url
  })

  afterAll(async () => {
    await handle.close()
    if (savedConfig === undefined) delete process.env['MCP_TASKS_CONFIG']
    else process.env['MCP_TASKS_CONFIG'] = savedConfig
    if (savedDb === undefined) delete process.env['MCP_TASKS_DB']
    else process.env['MCP_TASKS_DB'] = savedDb
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns 404 for unknown note id', async () => {
    const res = await fetch(`${baseUrl}/api/notes/NONEXISTENT-N-999`, { method: 'DELETE' })
    expect(res.status).toBe(404)
  })

  it('returns 204 on successful delete', async () => {
    const created = await fetch(`${baseUrl}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'To be deleted' }),
    })
    const note = await created.json() as { id: string }
    const res = await fetch(`${baseUrl}/api/notes/${encodeURIComponent(note.id)}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)
  })
})
