export type TaskStatus = 'queued' | 'in_progress' | 'blocked' | 'done'
export type TaskType = 'feature' | 'bug' | 'chore' | 'spike' | 'spec'
export type TaskPriority = 'high' | 'medium' | 'low' | 'normal'
export type MilestoneStatus = 'open' | 'closed'

export interface GitPr {
  number: number
  url?: string
  state: 'open' | 'closed' | 'merged'
}

export interface GitInfo {
  branch?: string
  pr?: GitPr
}

export interface Transition {
  from: string
  to: string
  at: string
  reason?: string | null
}

export interface Task {
  id: string
  title: string
  status: TaskStatus
  type: TaskType
  priority: TaskPriority
  project?: string
  milestone?: string | null
  labels?: string[]
  // Detail fields
  why?: string
  created?: string
  updated?: string
  last_activity?: string
  claimed_by?: string | null
  git?: GitInfo
  transitions?: Transition[]
  complexity?: number
}

export interface Milestone {
  id: string
  title: string
  status: MilestoneStatus
  due_date?: string | null
}

export interface ActivityEntry {
  task_id: string
  title: string
  from_status: TaskStatus
  to_status: TaskStatus
  at: string
  reason: string | null
}

export interface StatsEntry {
  project: string
  stats: Record<string, number>
}

export interface FilterState {
  project: string
  status: string
  milestone: string
  label: string
}
