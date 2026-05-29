/**
 * fuzzy.ts — shared fuzzy match + highlight primitives.
 *
 * Algorithm ported verbatim from design_handoff_life_os/reference/shared.jsx.
 * Used by: CommandPalette (P1-10), Brain search (P1-05), filter actions (P2-01).
 *
 * Do NOT drift this implementation — the scoring contract is shared across all consumers.
 */
import React from 'react'

export interface FuzzyMatch {
  score: number
  ranges: number[]
}

/**
 * Subsequence fuzzy match.
 *
 * Scoring:
 *   +1      per matched char
 *   +1.5*streak consecutive-run bonus (streak resets on each miss)
 *   +4      word-start bonus (index 0 or preceding char is a space)
 *
 * Returns null when query is not a subsequence of text.
 * Empty query returns { score: 0, ranges: [] }.
 */
export function fuzzy(query: string, text: string): FuzzyMatch | null {
  if (!query) return { score: 0, ranges: [] }
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0, ti = 0, score = 0, streak = 0
  const ranges: number[] = []
  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      ranges.push(ti)
      streak++; score += 1 + streak * 1.5
      if (ti === 0 || t[ti - 1] === ' ') score += 4
      qi++
    } else {
      streak = 0
    }
    ti++
  }
  return qi === q.length ? { score, ranges } : null
}

/**
 * highlight(text, ranges) — wraps matched indices in <mark> elements.
 *
 * Returns a React node array (plain strings interleaved with <mark> elements)
 * with stable numeric keys. When ranges is empty, returns the text string unchanged.
 *
 * Mark styling is handled in CSS / Tailwind:
 *   mark { color: var(--accent); font-weight: 600; background: transparent; }
 */
export function highlight(text: string, ranges: number[]): React.ReactNode {
  if (!ranges || ranges.length === 0) return text
  const set = new Set(ranges)
  const out: React.ReactNode[] = []
  let buf = ''
  let mark = false
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i)
    if (m !== mark) {
      if (buf) {
        out.push(mark ? React.createElement('mark', { key: i }, buf) : buf)
      }
      buf = ''
      mark = m
    }
    buf += text[i]
  }
  if (buf) {
    out.push(mark ? React.createElement('mark', { key: 'end' }, buf) : buf)
  }
  return out
}
