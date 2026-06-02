import type { Task, TaskPriority, TaskArea, TaskType, Milestone, ActivityEntry, StatsEntry, TodayResponse, ArtifactEntry, AcrStatusResponse, BrainSearchResponse, Skill, AgentLog, ProposalWithMatch, Engine, BatchCloseResponse } from './types'

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

export interface NewTaskFields {
  title: string
  project: string
  priority?: TaskPriority
  area?: TaskArea
  estimate_hours?: number
  why?: string
}

/** Full-field create for the New-task modal (P5-04). Surfaces the server's `{ error }` on failure. */
export async function createTask(
  fields: NewTaskFields,
): Promise<{ id: string; title: string; status: string; project: string }> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; message?: string }
    throw new Error(err.message ?? err.error ?? `Create failed: ${res.status}`)
  }
  return res.json() as Promise<{ id: string; title: string; status: string; project: string }>
}

/** Delete a task (P5-04). Throws on non-2xx so an optimistic mutation rolls back. */
export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(err.error ?? `Delete failed: ${res.status}`)
  }
}

export function fetchToday(targetMinutes?: number): Promise<TodayResponse> {
  const params = targetMinutes !== undefined ? `?target=${targetMinutes}` : ''
  return get<TodayResponse>(`/api/today${params}`)
}

/** Claim a task for the local dashboard user (MCPAT-064): sets claimed_by and, from todo, moves it to
 *  in_progress. Throws on non-2xx so an optimistic mutation rolls back. */
export async function claimTask(id: string): Promise<Task> {
  const res = await fetch(`/api/tasks/${id}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; message?: string }
    throw new Error(err.message ?? err.error ?? `Claim failed: ${res.status}`)
  }
  return res.json() as Promise<Task>
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

export async function quickCapture(
  text: string,
  context?: string,
): Promise<{ taskId: string; project: string }> {
  // P5-06: thread the dashboard's active project prefix as a routing bias. The P4-06 backend reads
  // `context` as a STRING prefix and validates it against known projects; an explicit `#PREFIX` in the
  // text still wins server-side, so context is only a tiebreaker for ambiguous captures.
  const res = await fetch('/api/capture/quick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(context ? { text, context } : { text }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText })) as { message?: string }
    throw new Error(err.message ?? `Capture failed: ${res.status}`)
  }
  return res.json() as Promise<{ taskId: string; project: string }>
}

// ── Notes ────────────────────────────────────────────────────────────────────

export interface NoteRecord {
  id: string
  body: string
  project: string
  task_id: string | null
  tags: string[]
  created_at: string
  updated_at: string
  brain_sync_failed?: boolean
}

export interface NoteFilters {
  project?: string
  task_id?: string
  limit?: number
}

export function fetchNotes(filters: NoteFilters = {}): Promise<NoteRecord[]> {
  const params: Record<string, string | undefined> = {
    project: filters.project,
    task_id: filters.task_id,
    limit: filters.limit?.toString(),
  }
  return get<NoteRecord[]>(`/api/notes${qs(params)}`)
}

export function fetchNote(id: string): Promise<NoteRecord> {
  return get<NoteRecord>(`/api/notes/${encodeURIComponent(id)}`)
}

export async function updateNote(id: string, fields: { body?: string; tags?: string[] }): Promise<NoteRecord> {
  const res = await fetch(`/api/notes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText })) as { message?: string }
    throw new Error(err.message ?? `Update failed: ${res.status}`)
  }
  return res.json() as Promise<NoteRecord>
}

export interface InferResult {
  intent: 'task' | 'note'
  confidence: number
}

export async function inferCapture(text: string, context?: string): Promise<InferResult> {
  try {
    const res = await fetch('/api/capture/infer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context ? { text, context } : { text }),
    })
    if (!res.ok) return { intent: 'task', confidence: 0 }
    return res.json() as Promise<InferResult>
  } catch {
    return { intent: 'task', confidence: 0 }
  }
}

export async function captureNote(
  text: string,
  project?: string,
): Promise<{ noteId: string; project: string }> {
  const res = await fetch('/api/capture/note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, project }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText })) as { message?: string }
    throw new Error(err.message ?? `Note capture failed: ${res.status}`)
  }
  return res.json() as Promise<{ noteId: string; project: string }>
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

/** Manual dispatch path — always sends source:'user'. */
export async function acrDispatch(
  title: string,
  detail: string,
): Promise<{ jobId?: string; error?: string }> {
  const res = await fetch('/api/acr/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, detail, source: 'user' }),
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

export interface BrainStatusResult {
  online: boolean
  latencyMs?: number
  reason?: 'tls' | 'timeout' | 'shape' | 'error'
}

/** Probe Brain MCP server liveness — uses the dedicated /api/brain/status route, not brain_search. */
export function fetchBrainStatus(): Promise<BrainStatusResult> {
  return get<BrainStatusResult>('/api/brain/status')
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

export interface TaskUpdateFields {
  title?: string
  why?: string
  priority?: TaskPriority
  estimate_hours?: number
  /** Assign a task to a milestone by id, or null/undefined to clear. */
  milestone?: string | null
  /** PARA area for the task. */
  area?: TaskArea | null
  /** Tags / labels for the task (replaces the full array on save). */
  tags?: string[]
  /** Task type (feature/bug/chore/spike/refactor/spec/plan). */
  type?: TaskType
}

export async function updateTask(
  id: string,
  fields: TaskUpdateFields,
): Promise<Task> {
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(err.error ?? `Update failed: ${res.status}`)
  }
  return res.json() as Promise<Task>
}

/** Thin wrapper for existing callers that only update priority. */
export function updateTaskPriority(id: string, priority: TaskPriority): Promise<Task> {
  return updateTask(id, { priority })
}

// P4-02: sprint closure — batch-close all done tasks
export async function closeBatch(project?: string): Promise<BatchCloseResponse> {
  const res = await fetch('/api/tasks/close-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project ? { project } : {}),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(err.error ?? `Close batch failed: ${res.status}`)
  }
  return res.json() as Promise<BatchCloseResponse>
}

export interface ProjectEntry {
  prefix: string
  name?: string
  path: string
}

export async function fetchProjects(): Promise<ProjectEntry[]> {
  const res = await fetch('/api/projects')
  if (!res.ok) return []
  return res.json() as Promise<ProjectEntry[]>
}

export async function createProject(fields: {
  prefix: string
  path: string
  name?: string
  storage?: 'global' | 'local'
}): Promise<ProjectEntry> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; message?: string }
    throw new Error(err.message ?? err.error ?? `Create project failed: ${res.status}`)
  }
  return res.json() as Promise<ProjectEntry>
}

export async function updateProject(
  prefix: string,
  fields: { name?: string },
): Promise<ProjectEntry> {
  const res = await fetch(`/api/projects/${prefix}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; message?: string }
    throw new Error(err.message ?? err.error ?? `Update project failed: ${res.status}`)
  }
  return res.json() as Promise<ProjectEntry>
}

export async function listDir(path?: string): Promise<{ path: string | null; dirs: string[] }> {
  const url = path ? `/api/fs/list?path=${encodeURIComponent(path)}` : '/api/fs/list'
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; message?: string }
    throw new Error(err.message ?? err.error ?? `List dir failed: ${res.status}`)
  }
  return res.json() as Promise<{ path: string | null; dirs: string[] }>
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

export interface PromoteSkillPayload {
  name: string
  desc: string
  engine: Engine
  match: string[]
  runs: 0
  minutesSaved: 0
  origin: string
  project: string
  /** Proposal savings — client-only, used for the optimistic promote log entry (server ignores). */
  savedPerRun?: number
}

/** Promote a proposal → a committed Skill. POST /api/skills. Source:'hermes'. */
export async function promoteSkill(payload: PromoteSkillPayload): Promise<{ id: string }> {
  // savedPerRun is client-only (drives the optimistic promote log); never send it to the skills
  // endpoint, whose contract is the skill-creation payload only.
  const { savedPerRun: _savedPerRun, ...body } = payload
  const res = await fetch('/api/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`promoteSkill failed: HTTP ${res.status}`)
  return res.json() as Promise<{ id: string }>
}

/** Client heuristic research — generates a ProposalWithMatch from task metadata.
 *  Falls back when POST /api/agent/research is unavailable.
 *  _match carries the derived skill match[] terms so promote can seed Skill.match[] reliably.
 */
export function buildProposalHeuristic(task: Task): ProposalWithMatch {
  const isSw = /\b(deploy|migrat|build|api|endpoint|bug|refactor|script|backup|database|db|crawl|scrape|test|ci|pipeline|audit|lighthouse|lint|typecheck|code|server|cron|postgres|webhook)\b/
    .test((task.title + ' ' + (task.tags ?? []).join(' ') + ' ' + (task.why ?? '')).toLowerCase())

  const engine: Engine = isSw ? 'acr' : 'n8n'

  // Derive a skill name from the task title (title-case first 4 words)
  const words = task.title.split(/\s+/).slice(0, 4)
  const skillName = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')

  // Derive match terms: distinctive words from title + tags, lowercase, ≥4 chars
  const titleWords = task.title.toLowerCase().split(/\W+/).filter(w => w.length >= 4)
  const tagWords = (task.tags ?? []).map(t => t.toLowerCase())
  const match = [...new Set([...titleWords, ...tagWords])].slice(0, 5)

  const steps = [
    `Gather inputs: collect the data or context needed for "${task.title}"`,
    `Execute: run the ${isSw ? 'script/command' : 'workflow'} to process the task automatically`,
    `Deliver: return results and notify you of completion`,
  ]

  return {
    id: `proposal-${task.id}-${Date.now()}`,
    taskId: task.id,
    project: task.project ?? 'GEN',
    skillName,
    taskTitle: task.title,
    summary: `Automate "${task.title}" so it runs ${isSw ? 'on ACR without manual steps' : 'via an n8n flow on a schedule'}`,
    steps,
    savedPerRun: 30,
    frequency: 'as needed',
    engine,
    _match: match,
  }
}
