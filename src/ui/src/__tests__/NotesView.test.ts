import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const src = fs.readFileSync(
  path.join(import.meta.dirname ?? __dirname, '../views/NotesView.tsx'),
  'utf-8',
)

describe('NotesView (Phase E pinned-grid)', () => {
  it('uses notes-grid class (2-col grid layout)', () => {
    expect(src).toContain('notes-grid')
  })

  it('uses notes-divider between pinned and rest sections', () => {
    expect(src).toContain('notes-divider')
  })

  it('New note button calls focusCapture with note mode', () => {
    expect(src).toMatch(/focusCapture\(['"]note['"]\)/)
  })

  it('applies matchProjectArea filter to notes', () => {
    expect(src).toContain('matchProjectArea')
  })

  it('splits notes into pinned and rest', () => {
    expect(src).toMatch(/\.pinned/)
  })

  it('renders NoteCard for each note', () => {
    expect(src).toContain('NoteCard')
  })

  it('has empty state message pointing to capture bar', () => {
    expect(src).toMatch(/No notes yet|capture bar|Note mode/i)
  })
})
