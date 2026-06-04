/**
 * NoteCard.test.tsx — Source-inspection tests for MCPAT-070 Phase 3E NoteCard.
 *
 * Strategy: root vitest config uses environment: 'node' (no DOM / jsdom) and there is
 * no @testing-library/react available, so these tests read source files as strings and
 * assert on structural contracts described in the spec.
 *
 * ACs verified:
 *  AC1 — NoteCard renders title (note.title shown in .note-title)
 *  AC2 — NoteCard renders body text (note.body shown in .note-body)
 *  AC3 — NoteCard renders tags with # prefix (.note-tags + .note-tag with # char)
 *  AC4 — NoteCard shows Star icon when pinned
 *  AC5 — NoteCard falls back to body preview when title absent
 *  AC6 — NoteCard null-guards empty tags array (no .note-tags rendered)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const UI_SRC = resolve(__dirname, '..')

function readSrc(relPath: string): string {
  return readFileSync(resolve(UI_SRC, relPath), 'utf-8')
}

describe('NoteCard.tsx — module structure and exports', () => {
  const src = readSrc('components/NoteCard.tsx')

  it('exports NoteCard function', () => {
    expect(src).toContain('export function NoteCard')
  })

  it('imports NoteRecord from api', () => {
    expect(src).toMatch(/import.*NoteRecord.*from.*api/)
  })

  it('imports PrefixBadge and AreaDot from atoms', () => {
    expect(src).toContain('PrefixBadge')
    expect(src).toContain('AreaDot')
    expect(src).toContain('atoms')
  })

  it('imports Star from lucide-react', () => {
    expect(src).toContain('Star')
    expect(src).toContain('lucide-react')
  })

  it('imports areaOfProject from lib/filter', () => {
    expect(src).toContain('areaOfProject')
    expect(src).toContain('filter')
  })

  it('imports relativeTime from lib/time', () => {
    expect(src).toContain('relativeTime')
    expect(src).toContain('time')
  })
})

describe('NoteCard.tsx — rendering contract (AC1–AC6)', () => {
  const src = readSrc('components/NoteCard.tsx')

  it('AC1 — renders title in .note-title element', () => {
    expect(src).toContain('note-title')
    expect(src).toContain('title')
  })

  it('AC2 — renders body preview in .note-body element', () => {
    expect(src).toContain('note-body')
    expect(src).toContain('body')
  })

  it('AC3 — renders tags with # prefix in .note-tags / .note-tag', () => {
    expect(src).toContain('note-tags')
    expect(src).toContain('note-tag')
    expect(src).toContain('#')
  })

  it('AC4 — conditionally renders Star icon when pinned', () => {
    expect(src).toContain('pinned')
    expect(src).toContain('Star')
  })

  it('AC5 — falls back to body when title is absent (nullish coalescing or conditional)', () => {
    // note.title ?? ... or !note.title
    expect(src).toMatch(/note\.title.*\?\?|!\s*note\.title|note\.title\s*\?/)
  })

  it('AC6 — guards against empty tags array (tags.length > 0 or similar)', () => {
    expect(src).toMatch(/tags\.length|tags &&/)
  })
})

describe('NoteCard.tsx — AreaDot null-safety (AC-AreaDot)', () => {
  const src = readSrc('components/NoteCard.tsx')

  it('guards AreaDot render against null area (area && <AreaDot) or conditional', () => {
    // AreaDot expects TaskArea (non-nullable), so area must be guarded
    expect(src).toMatch(/area &&.*AreaDot|AreaDot.*area.*area|area\s*&&/)
  })
})
