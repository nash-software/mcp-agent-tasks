/**
 * AdvisorChat.tsx — Presentational chat UI for the Advisor.
 * Owns its own thread state only. Everything else (tasks, notes, suggestions)
 * is passed from AdvisorView.
 */
import React, { useState, useRef, useEffect } from 'react'
import { Wand2, Send, Layers, FileText, Search, Bot } from 'lucide-react'
import { streamAdvisorChat, type ChatMessage } from '../api'
import { renderWithChips, localAdvice, SUGGESTED_PROMPTS, PERSONAS, type Suggestion, type PersonaId } from '../lib/advisor'
import type { Task, ActionDraft } from '../types'
import type { NoteRecord } from '../api'
import { ActionCard } from './ActionCard'

// ── Types ──────────────────────────────────────────────────────────────────

interface Msg {
  role: 'user' | 'assistant'
  text: string
}

interface Props {
  tasks: Task[]
  notes: NoteRecord[]
  suggestions: Suggestion[]
  onOpenTask: (id: string) => void
  live: boolean
  onLive: () => void
  mode: PersonaId
  onModeChange: (mode: PersonaId) => void
  projects?: string[]
}

// ── ChatHeader (non-exported inner component) ──────────────────────────────

function ChatHeader({ live, openCount }: { live: boolean; openCount: number }): React.JSX.Element {
  return (
    <div className="adv-chat-head">
      <div className="adv-avatar"><Wand2 size={16} /></div>
      <div className="adv-head-main">
        <div className="adv-head-title">Advisor</div>
        <div className="adv-head-sub">Reasons over your tasks, notes &amp; brain</div>
      </div>
      <div className="adv-ctx">
        <span className={`adv-ctx-chip${live ? ' live' : ''}`}>
          <span className="d" />{live ? 'Claude · live' : 'Claude'}
        </span>
        <span className="adv-ctx-chip">brain CLI</span>
        <span className="adv-ctx-chip">{openCount} tasks</span>
      </div>
    </div>
  )
}

// ── AdvisorChat ────────────────────────────────────────────────────────────

export function AdvisorChat({ tasks, notes, suggestions, onOpenTask, live, onLive, mode, onModeChange, projects = [] }: Props): React.JSX.Element {
  const openCount = tasks.filter(t => t.status !== 'done' && t.status !== 'closed' && t.status !== 'archived').length

  const greeting: Msg = {
    role: 'assistant',
    text: suggestions[0]
      ? `I've read your ${openCount} open tasks, ${notes.length} notes and the brain index. The one thing I'd flag first: ${suggestions[0].title.toLowerCase()}. Ask me anything, or tap a prompt below.`
      : `I've read your ${openCount} open tasks and ${notes.length} notes. Ask me anything about your work — I'll help you prioritise, unblock, or plan.`,
  }

  const [msgs, setMsgs] = useState<Msg[]>([greeting])
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const [nudge, setNudge] = useState<PersonaId | null>(null)
  // Map from message index to action drafts for that message (max 3 per message)
  const [actionDraftMap, setActionDraftMap] = useState<Map<number, ActionDraft[]>>(new Map())
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [msgs])

  function handleDraftStatusChange(msgIdx: number, draftId: string, status: ActionDraft['status']): void {
    setActionDraftMap(prev => {
      const next = new Map(prev)
      const drafts = next.get(msgIdx) ?? []
      next.set(msgIdx, drafts.map(d => d.id === draftId ? { ...d, status } : d))
      return next
    })
  }

  async function send(textArg?: string): Promise<void> {
    const text = (textArg ?? val).trim()
    if (!text || busy) return
    setVal('')
    setNudge(null)
    const userMsg: Msg = { role: 'user', text }
    setMsgs(prev => [...prev, userMsg, { role: 'assistant', text: '' }])
    setBusy(true)

    const apiMessages: ChatMessage[] = [...msgs, userMsg].map(m => ({ role: m.role, content: m.text }))
    // The assistant message will be at msgs.length + 1 (after the user msg we just appended)
    // We capture it after setState — use a local variable to track the index
    let currentMsgIdx = -1

    setMsgs(prev => {
      currentMsgIdx = prev.length - 1 // last appended (assistant placeholder)
      return prev
    })

    try {
      for await (const frame of streamAdvisorChat(apiMessages, sessionId, mode)) {
        if (frame.type === 'delta') {
          onLive()
          setMsgs(prev => {
            currentMsgIdx = prev.length - 1
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.role === 'assistant') {
              next[next.length - 1] = { ...last, text: last.text + frame.text }
            }
            return next
          })
        } else if (frame.type === 'session') {
          setSessionId(frame.sessionId)
        } else if (frame.type === 'error') {
          throw new Error(frame.message)
        } else if (frame.type === 'done') {
          break
        } else if (frame.type === 'nudge') {
          const validModes: PersonaId[] = ['pm', 'chairman', 'coach']
          const target = frame.targetMode as PersonaId
          if (validModes.includes(target)) setNudge(target)
        } else if (frame.type === 'action_draft') {
          const msgIndex = currentMsgIdx >= 0 ? currentMsgIdx : 0
          setActionDraftMap(prev => {
            const next = new Map(prev)
            const existing = next.get(msgIndex) ?? []
            if (existing.length >= 3) return prev // max 3 per message
            const draft: ActionDraft = {
              id: frame.id,
              type: frame.draftType as ActionDraft['type'],
              title: frame.title,
              project: frame.project,
              priority: frame.priority as ActionDraft['priority'],
              body: frame.body,
              source_response_id: String(msgIndex),
              status: 'pending',
            }
            next.set(msgIndex, [...existing, draft])
            return next
          })
        }
      }
    } catch {
      const fallback = localAdvice(text, tasks, suggestions)
      setMsgs(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', text: fallback }
        return next
      })
    } finally {
      setBusy(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const showPrompts = msgs.length <= 1

  return (
    <div className="adv-chat">
      <ChatHeader live={live} openCount={openCount} />

      <div className="adv-thread" ref={threadRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`adv-msg ${m.role}`}>
            {m.role === 'assistant' && (
              <div className="adv-msg-ico"><Wand2 size={12} /></div>
            )}
            {m.role === 'assistant' && busy && i === msgs.length - 1 && m.text === '' ? (
              <div className="adv-bubble thinking">
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
            ) : (
              <div className="adv-bubble">
                {m.role === 'assistant'
                  ? renderWithChips(m.text, onOpenTask)
                  : m.text}
              </div>
            )}
            {m.role === 'assistant' && (actionDraftMap.get(i) ?? []).length > 0 && (
              <div className="action-cards">
                {(actionDraftMap.get(i) ?? []).map(draft => (
                  <ActionCard
                    key={draft.id}
                    draft={draft}
                    projects={projects}
                    onStatusChange={(draftId, status) => handleDraftStatusChange(i, draftId, status)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {showPrompts && (
        <div className="adv-suggested">
          {SUGGESTED_PROMPTS[mode].map(p => (
            <button key={p} className="prompt-chip" onClick={() => void send(p)}>
              {p}
            </button>
          ))}
        </div>
      )}

      {nudge !== null && (
        <div className="adv-nudge">
          <span className="adv-nudge-text">Better suited for {PERSONAS[nudge].label}?</span>
          <button className="adv-nudge-btn primary" onClick={() => { onModeChange(nudge); setNudge(null) }}>
            Continue with {PERSONAS[nudge].label}
          </button>
          <button className="adv-nudge-btn" onClick={() => setNudge(null)}>Ignore</button>
        </div>
      )}

      <div className="adv-composer">
        <div className="adv-tools">
          <span className="tool-chip"><Layers size={10} />@tasks</span>
          <span className="tool-chip"><FileText size={10} />@notes</span>
          <span className="tool-chip"><Search size={10} />brain search</span>
          <span className="tool-chip"><Bot size={10} />ACR</span>
        </div>
        <div className="adv-input-row">
          <textarea
            className="adv-input"
            rows={1}
            placeholder="Ask anything about your work…"
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={busy}
          />
          <button
            className="adv-send"
            onClick={() => void send()}
            disabled={!val.trim() || busy}
            aria-label="Send"
          >
            <Send size={14} />
          </button>
        </div>
        <div className="adv-foot-hint">
          {live ? 'Connected to Claude · responses stream live' : 'Claude offline — answering from local context'}
        </div>
      </div>
    </div>
  )
}
