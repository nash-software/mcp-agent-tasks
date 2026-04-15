import type { Task, Milestone, ActivityEntry, StatsEntry } from './types'

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
  return get<Task[]>(`/api/tasks${qs(filters)}`)
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
