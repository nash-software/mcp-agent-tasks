import type { Task, Milestone, ActivityEntry, StatsEntry, TodayResponse, ArtifactEntry, AcrStatusResponse, BrainSearchResponse, Skill, AgentLog } from './types'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`)
  return res.json() as Promise<T>
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) p.set(k, v)
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export interface TaskFilters {
  project?: string
  status?: string
  milestone?: string
  label?: string
}

export function fetchTasks(filters: TaskFilters = {}): Promise<Task[]> {
  return get<Task[]>(`/api/tasks${qs(filters as Record<string, string | undefined>)}`)
}

export function fetchMilestones(): Promise<Milestone[]> {
  return get<Milestone[]>('/api/milestones')
}

export function fetchActivity(): Promise<ActivityEntry[]> {
  return get<ActivityEntry[]>('/api/activity')
}

export function fetchStats(): Promise<StatsEntry[]> {
  return get<StatsEntry[]>('/api/stats')
}

export async function transcribeAudio(audioBlob: Blob, filename = 'recording.wav'): Promise<string> {
  const form = new FormData()
  form.append('file', audioBlob, filename)
  const res = await fetch('/api/transcribe', { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText })) as { message?: string }
    throw new Error(err.message ?? `Transcription failed: ${res.status}`)
  }
  const data = await res.json() as { text: string }
  return data.text
}

export async function createDraftTask(data: {
  title: string; project: string; body?: string
}): Promise<{ id: string; title: string; status: string; project: string }> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<{ id: string; title: string; status: string; project: string }>
}

export function fetchToday(targetMinutes?: number): Promise<TodayResponse> {
  const params = targetMinutes !== undefined ? `?target=${targetMinutes}` : ''
  return get<TodayResponse>(`/api/today${params}`)
}

export async function scheduleTask(id: string, date: string | null): Promise<Task> {
  const res = await fetch(`/api/tasks/${id}/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(err.error ?? `Schedule failed: ${res.status}`)
  }
  return res.json() as Promise<Task>
}

export async function quickCapture(text: string): Promise<{ taskId: string; project: string }> {
  const res = await fetch('/api/capture/quick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText })) as { message?: string }
    throw new Error(err.message ?? `Capture failed: ${res.status}`)
  }
  return res.json() as Promise<{ taskId: string; project: string }>
}

export async function fetchConfig(): Promise<{ conductorLocalUrl?: string; conductorVpsUrl?: string; projectPrefixes?: string[] }> {
  const res = await fetch('/api/config')
  if (!res.ok) return {}
  return res.json() as Promise<{ conductorLocalUrl?: string; conductorVpsUrl?: string; projectPrefixes?: string[] }>
}

export interface BrainDumpCandidate {
  title: string
  project: string
  area: 'client' | 'personal' | 'outsource' | 'internal'
  why?: string
}

export async function brainDump(text: string): Promise<{ candidates: BrainDumpCandidate[]; error?: string }> {
  const res = await fetch('/api/capture/braindump', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  return res.json() as Promise<{ candidates: BrainDumpCandidate[]; error?: string }>
}

export async function commitCandidates(candidates: BrainDumpCandidate[]): Promise<{ created: string[] }> {
  const res = await fetch('/api/capture/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidates }),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<{ created: string[] }>
}

export async function acrDispatch(title: string, detail: string): Promise<{ jobId?: string; error?: string }> {
  const res = await fetch('/api/acr/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, detail }),
  })
  return res.json() as Promise<{ jobId?: string; error?: string }>
}

export function getAcrStatus(): Promise<AcrStatusResponse> {
  return get<AcrStatusResponse>('/api/acr/status')
}

export async function createMilestone(data: {
  id: string; title: string; project: string; description?: string; due_date?: string
}): Promise<Milestone> {
  const res = await fetch('/api/milestones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<Milestone>
}

export function getArtifacts(): Promise<ArtifactEntry[]> {
  return get<ArtifactEntry[]>('/api/artifacts')
}

export async function markArtifactOpened(filePath: string): Promise<void> {
  await fetch('/api/artifacts/opened', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  })
}

export function searchBrain(query: string): Promise<BrainSearchResponse> {
  return get<BrainSearchResponse>(`/api/brain/search?q=${encodeURIComponent(query)}`)
}

export async function transitionTask(
  id: string,
  to: string,
  reason?: string,
): Promise<Task> {
  const res = await fetch(`/api/tasks/${id}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, reason }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(err.error ?? `Transition failed: ${res.status}`)
  }
  return res.json() as Promise<Task>
}

export async function updateTaskPriority(
  id: string,
  priority: string,
): Promise<Task> {
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(err.error ?? `Update failed: ${res.status}`)
  }
  return res.json() as Promise<Task>
}

export interface ProjectEntry {
  prefix: string
  path: string
}

export async function fetchProjects(): Promise<ProjectEntry[]> {
  const res = await fetch('/api/projects')
  if (!res.ok) return []
  return res.json() as Promise<ProjectEntry[]>
}

// ── Phase 2 / Hermes endpoints ─────────────────────────────────────────────

export async function fetchSkills(): Promise<Skill[]> {
  try {
    const res = await fetch('/api/skills')
    if (!res.ok) return []
    return res.json() as Promise<Skill[]>
  } catch {
    return []
  }
}

export async function signoffTask(id: string): Promise<Task> {
  const res = await fetch(`/api/tasks/${id}/signoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(err.error ?? `Signoff failed: ${res.status}`)
  }
  return res.json() as Promise<Task>
}

export async function clearSignoffTask(id: string): Promise<Task> {
  const res = await fetch(`/api/tasks/${id}/signoff`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(err.error ?? `Clear signoff failed: ${res.status}`)
  }
  return res.json() as Promise<Task>
}

export async function fetchAgentLog(): Promise<AgentLog[]> {
  try {
    const res = await fetch('/api/agent/log')
    if (!res.ok) return []
    return res.json() as Promise<AgentLog[]>
  } catch {
    return []
  }
}

export async function dispatchToAcr(taskId: string, opts: { source: 'hermes'; skillId?: string }): Promise<{ jobId?: string; error?: string }> {
  const res = await fetch('/api/acr/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, ...opts }),
  })
  // The endpoint returns 200 with {jobId} or {error:'ACR offline'}; a non-2xx is a real failure
  // that must reject so the mutation's onError rollback fires (don't treat 4xx/5xx as success).
  if (!res.ok) throw new Error(`dispatchToAcr failed: HTTP ${res.status}`)
  return res.json() as Promise<{ jobId?: string; error?: string }>
}

export async function postAgentResearch(taskId: string): Promise<{ proposalId?: string; error?: string }> {
  const res = await fetch('/api/agent/research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  })
  if (!res.ok) throw new Error(`postAgentResearch failed: HTTP ${res.status}`)
  return res.json() as Promise<{ proposalId?: string; error?: string }>
}

export async function postAgentSchedule(taskId: string): Promise<{ error?: string }> {
  const res = await fetch('/api/agent/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  })
  if (!res.ok) throw new Error(`postAgentSchedule failed: HTTP ${res.status}`)
  return res.json() as Promise<{ error?: string }>
}
