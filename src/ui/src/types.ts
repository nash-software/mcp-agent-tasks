export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked' | 'archived' | 'draft' | 'approved'
export type TaskType = 'feature' | 'bug' | 'chore' | 'spike' | 'refactor' | 'spec' | 'plan'
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low'
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
  auto_captured?: boolean
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

export interface StatsData {
  by_status: Record<TaskStatus, number>
  completion_rate: number
  stale_count: number
}

export interface StatsEntry {
  project: string
  stats: StatsData
}

export interface FilterState {
  project: string
  status: string
  milestone: string
  label: string
}
