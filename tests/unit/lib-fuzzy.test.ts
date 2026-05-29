/**
 * Unit tests for src/ui/src/lib/fuzzy.ts
 * Tests the fuzzy() and highlight() primitives per P1-10 spec §Testing.
 *
 * Note: Tests run in the root vitest context (no React available at root).
 * fuzzy() has no React dependency. highlight() returns React nodes — we test
 * its shape via duck-typing ($$typeof, type, props) without importing React.
 */
import { describe, it, expect } from 'vitest'
import { fuzzy, highlight } from '../../src/ui/src/lib/fuzzy'

// React.createElement returns objects with $$typeof Symbol(react.element)
// We check for the 'type' and 'props' fields without importing React itself.
function isMarkElement(node: unknown): node is { type: string; props: { children: string } } {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as Record<string, unknown>)['type'] === 'mark' &&
    typeof (node as Record<string, unknown>)['props'] === 'object'
  )
}

describe('fuzzy()', () => {
  it('subsequence match — returns non-null with correct ranges', () => {
    const result = fuzzy('tdy', 'go to today')
    expect(result).not.toBeNull()
    const { ranges } = result!
    expect(ranges).toHaveLength(3)
    const text = 'go to today'
    expect(text[ranges[0]]).toBe('t')
    expect(text[ranges[1]]).toBe('d')
    expect(text[ranges[2]]).toBe('y')
    expect(ranges[0]).toBeLessThan(ranges[1])
    expect(ranges[1]).toBeLessThan(ranges[2])
  })

  it('no-match returns null for impossible query', () => {
    expect(fuzzy('zzz', 'go to today')).toBeNull()
  })

  it('no-match returns null when chars are not a subsequence (out of order)', () => {
    // 'ydt' — y appears after d and t in 'today', not before
    expect(fuzzy('ydt', 'today')).toBeNull()
  })

  it('word-start bonus — match at word boundary scores higher than mid-word match', () => {
    // 'b' at start of 'brain' (index 5, preceded by space) gets +4 bonus
    const wordStart = fuzzy('b', 'open brain dump')
    // 'b' mid-word in 'subtask' (index 2, preceded by 'u') gets no +4 bonus
    const midWord = fuzzy('b', 'subtask')
    expect(wordStart).not.toBeNull()
    expect(midWord).not.toBeNull()
    expect(wordStart!.score).toBeGreaterThan(midWord!.score)
  })

  it('word-start bonus — leading char (index 0) also receives the +4 bonus', () => {
    // 't' at index 0 of 'today' → +1 + 1.5*1 + 4 = 6.5
    const leading = fuzzy('t', 'today')
    // 't' mid-word in 'artifacts' → no word-start bonus
    const notLeading = fuzzy('t', 'artifacts')
    expect(leading).not.toBeNull()
    expect(notLeading).not.toBeNull()
    expect(leading!.score).toBeGreaterThan(notLeading!.score)
  })

  it('consecutive-run bonus — fully consecutive match scores higher than scattered', () => {
    // 'today' matches 'today' with max streak bonus
    const consecutive = fuzzy('today', 'today')
    // 'today' scattered in 'to do all day' — same chars but non-consecutive
    const nonConsecutive = fuzzy('today', 'to do all day')
    expect(consecutive).not.toBeNull()
    expect(nonConsecutive).not.toBeNull()
    expect(consecutive!.score).toBeGreaterThan(nonConsecutive!.score)
  })

  it('empty query returns {score: 0, ranges: []}', () => {
    const result = fuzzy('', 'anything')
    expect(result).toEqual({ score: 0, ranges: [] })
  })

  it('returns correct score for single char match at index 0', () => {
    // char at 0: +1 (char) + 1.5*1 (streak=1) + 4 (word-start) = 6.5
    const result = fuzzy('t', 'today')
    expect(result).not.toBeNull()
    expect(result!.score).toBeCloseTo(6.5)
    expect(result!.ranges).toEqual([0])
  })

  it('returns null for non-empty query against empty text', () => {
    expect(fuzzy('abc', '')).toBeNull()
  })
})

describe('highlight()', () => {
  it('empty ranges returns text unchanged as a plain string', () => {
    const result = highlight('hello', [])
    expect(result).toBe('hello')
  })

  it('wraps matched indices in mark elements and leaves other chars plain', () => {
    // "today" with ranges [0, 1] → "to" in mark, "day" plain
    const result = highlight('today', [0, 1])
    expect(Array.isArray(result)).toBe(true)
    const nodes = result as unknown[]
    const markEl = nodes.find(isMarkElement)
    expect(markEl).toBeDefined()
    expect(markEl!.props.children).toBe('to')
    // Remaining plain text
    const plain = nodes.filter(n => typeof n === 'string').join('')
    expect(plain).toBe('day')
  })

  it('wraps only the exact specified indices', () => {
    // "brain" with range [0] → "b" in mark, "rain" plain
    const result = highlight('brain', [0])
    expect(Array.isArray(result)).toBe(true)
    const nodes = result as unknown[]
    const markEl = nodes.find(isMarkElement)
    expect(markEl).toBeDefined()
    expect(markEl!.props.children).toBe('b')
    const plain = nodes.filter(n => typeof n === 'string').join('')
    expect(plain).toBe('rain')
  })

  it('handles null ranges gracefully by returning text unchanged', () => {
    // Guard against runtime JS call with null (TypeScript prevents it statically)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = highlight('test', null as any)
    expect(result).toBe('test')
  })

  it('full text highlighted — all chars in mark when all indices supplied', () => {
    const result = highlight('abc', [0, 1, 2])
    expect(Array.isArray(result)).toBe(true)
    const nodes = result as unknown[]
    const markEl = nodes.find(isMarkElement)
    expect(markEl).toBeDefined()
    expect(markEl!.props.children).toBe('abc')
  })
})
