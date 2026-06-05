/**
 * AdvisorView.tsx — Self-fetching container for the Advisor panel.
 * Mirrors every sibling view: self-fetches tasks + notes, computes suggestions,
 * and passes everything down to AdvisorChat + SuggestionCard presentational components.
 */
import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { fetchNotes, transitionTask, signoffTask } from '../api'
import { useTasks } from '../hooks/useTasks'
import { buildSuggestions, type SuggestionId } from '../lib/advisor'
import { AdvisorChat } from '../components/AdvisorChat'
import { SuggestionCard } from '../components/SuggestionCard'
import type { PanelState } from '../types'

interface Props {
  onOpenPanel: (panel: PanelState) => void
}

export function AdvisorView({ onOpenPanel }: Props): React.JSX.Element {
  const queryClient = useQueryClient()

  // ── Data fetching ─────────────────────────────────────────────────────────
  const { tasks } = useTasks()
  const { data: notes = [] } = useQuery({
    queryKey: ['notes'],
    queryFn: () => fetchNotes({ limit: 200 }),
  })

  // ── Capacity target ───────────────────────────────────────────────────────
  const [target] = useState<number>(() => {
    const raw = localStorage.getItem('lifeos-target')
    const mins = raw !== null ? parseFloat(raw) : NaN
    return isNaN(mins) ? 8 : mins / 60
  })

  // ── Suggestions ───────────────────────────────────────────────────────────
  const [seed, setSeed] = useState(0)
  const [dismissed, setDismissed] = useState<SuggestionId[]>([])
  const [live, setLive] = useState(false)

  const all = useMemo(
    () => buildSuggestions(tasks, notes, target),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, notes, target, seed],
  )
  const suggestions = all.filter(s => !dismissed.includes(s.id))

  // ── Navigation ────────────────────────────────────────────────────────────
  const onOpenTask = (id: string): void => onOpenPanel({ mode: 'detail', taskId: id })

  // ── Mutations ─────────────────────────────────────────────────────────────
  const commitMut = useMutation({
    mutationFn: (id: string) => transitionTask(id, 'in_progress'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['today'] })
    },
  })

  const hermesMut = useMutation({
    mutationFn: (id: string) => signoffTask(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="advisor-view fade-up">
      <AdvisorChat
        tasks={tasks}
        notes={notes}
        suggestions={all}
        onOpenTask={onOpenTask}
        live={live}
        onLive={() => setLive(true)}
      />
      <div className="sugg-section">
        <div className="sugg-section-head">
          <span className="section-label">Suggestions</span>
          <span className="sugg-sub">synthesised from your tasks, notes &amp; brain</span>
          <button
            className="icon-btn"
            title="Refresh"
            onClick={() => { setDismissed([]); setSeed(s => s + 1) }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        {suggestions.length === 0
          ? <div className="hero-empty">All clear — nothing needs your attention right now.</div>
          : suggestions.map(s => (
            <SuggestionCard
              key={s.id}
              s={s}
              onDismiss={id => setDismissed(d => [...d, id])}
              onOpen={onOpenTask}
              onCommit={c => commitMut.mutate(c)}
              onHermes={h => hermesMut.mutate(h)}
            />
          ))
        }
      </div>
    </div>
  )
}
