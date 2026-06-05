import { describe, it, expect, vi, afterEach } from 'vitest'
import { createNote, deleteNote } from '../api'

afterEach(() => { vi.restoreAllMocks() })

describe('createNote', () => {
  it('POSTs to /api/notes with title', async () => {
    const mockNote = { id: 'GEN-N-001', title: 'My note', body: '', project: 'GEN', tags: [], created_at: '', updated_at: '' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockNote,
    }))
    const result = await createNote({ title: 'My note' })
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/notes', expect.objectContaining({
      method: 'POST',
    }))
    expect(result.title).toBe('My note')
  })

  it('throws when server returns error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'TITLE_REQUIRED' }),
    }))
    await expect(createNote({ title: '' })).rejects.toThrow('TITLE_REQUIRED')
  })
})

describe('deleteNote', () => {
  it('sends DELETE to /api/notes/:id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }))
    await deleteNote('GEN-N-001')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/notes/GEN-N-001',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})
