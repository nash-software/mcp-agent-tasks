/**
 * AdvisorView.tsx — Self-fetching container for the Advisor panel.
 * Mirrors every sibling view: self-fetches tasks + notes, computes suggestions,
 * and passes everything down to AdvisorChat + SuggestionCard presentational components.
 */
import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { fetchNotes, transitionTask, signoffTask, closeAdvisorSession } from '../api'
import { useTasks } from '../hooks/useTasks'
import { useGoals } from '../hooks/useGoals'
import { buildSuggestions, type SuggestionId, type PersonaId } from '../lib/advisor'
import { AdvisorChat } from '../components/AdvisorChat'
import { ModeSelector } from '../components/ModeSelector'
import { SuggestionCard } from '../components/SuggestionCard'
import { MemoriesSection } from '../components/MemoriesSection'
import type { PanelState } from '../types'

interface Props {
  onOpenPanel: (panel: PanelState) => void
}

export function AdvisorView({ onOpenPanel }: Props): React.JSX.Element {
  const queryClient = useQueryClient()

  // ── Data fetching ─────────────────────────────────────────────────────────
  const { tasks } = useTasks()
  const { activeGoals } = useGoals()
  const notesQuery = useQuery({
    queryKey: ['notes'],
    queryFn: () => fetchNotes({ limit: 200 }),
  })
  const notes = notesQuery.data ?? []

  // ── Project filter ────────────────────────────────────────────────────────
  const [projectFilter, setProjectFilter] = useState<string | null>(null)

  const allProjects = useMemo(() => {
    const prefixes = new Set<string>()
    for (const t of tasks) {
      const prefix = t.id.split('-')[0]
      if (prefix) prefixes.add(prefix)
    }
    for (const n of notes) prefixes.add(n.project)
    return Array.from(prefixes).sort()
  }, [tasks, notes])

  const filteredTasks = projectFilter
    ? tasks.filter(t => t.id.startsWith(projectFilter + '-'))
    : tasks
  const filteredNotes = projectFilter
    ? notes.filter(n => n.project === projectFilter)
    : notes

  // ── Capacity target ───────────────────────────────────────────────────────
  const [target] = useState<number>(() => {
    const raw = localStorage.getItem('lifeos-target')
    const mins = raw !== null ? parseFloat(raw) : NaN
    return isNaN(mins) ? 8 : mins / 60
  })

  // ── Session tracking ──────────────────────────────────────────────────────
  // Refs (not state) so the cleanup useEffect closure always reads the latest values.
  const sessionIdRef = useRef<string | undefined>(undefined)
  const sessionStartedAtRef = useRef<string | undefined>(undefined)
  const modeRef = useRef<PersonaId>('pm')

  // ── Mode (persona) ────────────────────────────────────────────────────────
  const [mode, setMode] = useState<PersonaId>(() => {
    const saved = localStorage.getItem('lifeos-advisor-mode')
    return (saved === 'pm' || saved === 'chairman' || saved === 'coach') ? saved : 'pm'
  })

  function handleModeChange(newMode: PersonaId): void {
    setMode(newMode)
    modeRef.current = newMode
    localStorage.setItem('lifeos-advisor-mode', newMode)
  }

  function handleSessionStart(id: string, startedAt: string): void {
    sessionIdRef.current = id
    sessionStartedAtRef.current = startedAt
  }

  const goalSnapshot = activeGoals[0]?.title ?? ''

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    return () => {
      const id = sessionIdRef.current
      const startedAt = sessionStartedAtRef.current
      if (id && startedAt) {
        void closeAdvisorSession(id, modeRef.current, startedAt, goalSnapshot)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Suggestions ───────────────────────────────────────────────────────────
  const [seed, setSeed] = useState(0)
  const [dismissed, setDismissed] = useState<SuggestionId[]>([])
  const [live, setLive] = useState(false)

  const all = useMemo(
    () => buildSuggestions(filteredTasks, filteredNotes, target, activeGoals),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredTasks, filteredNotes, target, activeGoals, seed],
  )
  const suggestions = all.filter(s => !dismissed.includes(s.id))

  // ── Auto-rerun within 2s of any note save ─────────────────────────────────
  const prevNotesUpdatedAt = useRef<number>(notesQuery.dataUpdatedAt)
  useEffect(() => {
    if (notesQuery.dataUpdatedAt !== prevNotesUpdatedAt.current) {
      prevNotesUpdatedAt.current = notesQuery.dataUpdatedAt
      const timer = setTimeout(() => {
        setDismissed([])
        setSeed(s => s + 1)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [notesQuery.dataUpdatedAt])

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
      <ModeSelector mode={mode} onModeChange={handleModeChange} />
      <AdvisorChat
        tasks={filteredTasks}
        notes={filteredNotes}
        suggestions={all}
        onOpenTask={onOpenTask}
        live={live}
        onLive={() => setLive(true)}
        mode={mode}
        onModeChange={handleModeChange}
        projects={allProjects}
        onSessionStart={handleSessionStart}
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

        {allProjects.length > 1 && (
          <div className="advisor-project-filter">
            <button
              className={`adv-proj-chip${projectFilter === null ? ' active' : ''}`}
              onClick={() => setProjectFilter(null)}
            >
              All
            </button>
            {allProjects.map(prefix => (
              <button
                key={prefix}
                className={`adv-proj-chip${projectFilter === prefix ? ' active' : ''}`}
                onClick={() => setProjectFilter(prev => prev === prefix ? null : prefix)}
              >
                {prefix}
              </button>
            ))}
          </div>
        )}

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
      <MemoriesSection />
    </div>
  )
}
