/**
 * SkillCard — grid card for a Skill in the "Skills & automations" section.
 * Port from design_handoff_life_os/reference/agent.jsx (SkillCard).
 *
 * Renders:
 *   Bolt icon + name + engine chip (ACR/n8n/Hermes with matching icon)
 *   desc
 *   mono meta line: {runs} runs · {fmtSaved(minutesSaved)} saved · last {lastRun}
 */
import React from 'react'
import { Zap, Server, Repeat, Bot } from 'lucide-react'
import { fmtSaved } from '../lib/triage'
import type { Skill } from '../types'

interface SkillCardProps {
  skill: Skill
  onRun?: (skill: Skill) => void
}

/** Engine chip: label + icon, coloured per engine. */
function EngineChip({ engine }: { engine: Skill['engine'] }): React.JSX.Element {
  const label = engine === 'acr' ? 'ACR' : engine === 'n8n' ? 'n8n' : 'Hermes'
  const colorClass =
    engine === 'acr' ? 'text-status-red bg-red-950' :
    engine === 'n8n' ? 'text-status-blue bg-blue-950' :
    'text-status-green bg-green-950'

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-badge font-mono text-xs font-medium ${colorClass}`}
    >
      {engine === 'acr' ? <Server size={10} /> : engine === 'n8n' ? <Repeat size={10} /> : <Bot size={10} />}
      {label}
    </span>
  )
}

export function SkillCard({ skill, onRun }: SkillCardProps): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-card bg-surface-1 border border-surface-3 hover:bg-surface-2 transition-colors">
      {/* Icon */}
      <div className="flex items-center justify-center w-7 h-7 rounded-badge bg-surface-2 shrink-0 mt-0.5">
        <Zap size={14} className="text-ink-muted" />
      </div>

      {/* Main */}
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        {/* Name + engine chip */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-ink truncate">{skill.name}</span>
          <EngineChip engine={skill.engine} />
        </div>

        {/* Description */}
        {skill.desc && (
          <div className="text-xs text-ink-2 line-clamp-2 leading-relaxed">{skill.desc}</div>
        )}

        {/* Meta line — mono, tabular-nums */}
        <div className="font-mono text-xs text-ink-muted tabular-nums flex items-center gap-1 flex-wrap">
          <span>{skill.runs} runs</span>
          <span className="text-ink-faint">·</span>
          <span>{fmtSaved(skill.minutesSaved)} saved</span>
          <span className="text-ink-faint">·</span>
          <span>last {skill.lastRun}</span>
        </div>
      </div>

      {/* Optional run button */}
      {onRun && (
        <button
          className="flex items-center gap-1 px-2.5 py-1 rounded-badge bg-surface-2 text-xs text-ink-muted hover:text-ink transition-colors shrink-0 self-start mt-0.5"
          onClick={() => { onRun(skill) }}
          title={`Run ${skill.name}`}
        >
          <Zap size={11} />
          Run
        </button>
      )}
    </div>
  )
}
