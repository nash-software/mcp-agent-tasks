import React, { useState, useEffect } from 'react'
import type { Task } from '../types'

interface ProjectInfo {
  prefix: string
  path: string
}

interface ConductorConfig {
  conductorLocalUrl?: string
  conductorVpsUrl?: string
}

function buildPrompt(task: Task): string {
  const body = task.why ?? ''
  const truncated = body.length > 1000 ? body.slice(0, 1000) + '...' : body
  return truncated ? `${task.title}: ${truncated}` : task.title
}

function buildClipboardCommand(task: Task, projectPath: string): string {
  const prompt = buildPrompt(task).replace(/"/g, '\\"')
  return `cd ${JSON.stringify(projectPath)} && claude "${prompt}"`
}

async function dispatchToConductor(
  conductorUrl: string,
  task: Task,
  projectPath: string,
): Promise<string> {
  const prompt = buildPrompt(task)
  const res = await fetch(`${conductorUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cwd: projectPath,
      name: task.id,
      initialInput: prompt,
    }),
  })
  if (!res.ok) throw new Error(`Conductor responded ${res.status}`)
  const data = await res.json() as { id: string }
  return data.id
}

interface Props {
  task: Task
}

export function ActionButton({ task }: Props): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [config, setConfig] = useState<ConductorConfig>({})
  const [copied, setCopied] = useState(false)
  const [dispatching, setDispatching] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => setProjects(d as ProjectInfo[]))
    fetch('/api/config').then(r => r.json()).then(d => setConfig(d as ConductorConfig))
  }, [])

  const projectPath = projects.find(p => p.prefix === task.project)?.path

  const handleCopy = async (): Promise<void> => {
    if (!projectPath) return
    const cmd = buildClipboardCommand(task, projectPath)
    await navigator.clipboard.writeText(cmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleConductor = async (url: string, label: string): Promise<void> => {
    if (!projectPath) return
    setDispatching(label)
    try {
      const sessionId = await dispatchToConductor(url, task, projectPath)
      window.open(`${url}/?session=${sessionId}`, '_blank')
    } catch {
      setDispatching('failed')
      setTimeout(() => setDispatching(null), 2000)
      return
    }
    setDispatching(null)
  }

  if (!projectPath) return <></>

  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={handleCopy}
        className="px-2.5 py-1 text-xs font-medium rounded bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
      >
        {copied ? 'Copied!' : 'Copy command'}
      </button>
      {config.conductorLocalUrl && (
        <button
          onClick={() => handleConductor(config.conductorLocalUrl!, 'local')}
          disabled={dispatching !== null}
          className="px-2.5 py-1 text-xs font-medium rounded bg-indigo-800 text-indigo-200 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {dispatching === 'local' ? 'Opening...' : 'Conductor (local)'}
        </button>
      )}
      {config.conductorVpsUrl && (
        <button
          onClick={() => handleConductor(config.conductorVpsUrl!, 'vps')}
          disabled={dispatching !== null}
          className="px-2.5 py-1 text-xs font-medium rounded bg-violet-800 text-violet-200 hover:bg-violet-700 disabled:opacity-50 transition-colors"
        >
          {dispatching === 'vps' ? 'Opening...' : dispatching === 'failed' ? 'Failed' : 'Conductor (VPS)'}
        </button>
      )}
    </div>
  )
}
