export type TaskStatus = 'queued' | 'in_progress' | 'blocked' | 'done'
export type TaskType = 'feature' | 'bug' | 'chore' | 'spike' | 'spec'
export type TaskPriority = 'high' | 'medium' | 'low' | 'normal'
export type MilestoneStatus = 'open' | 'closed'

export interface Task {
  id: string
  title: string
  status: TaskStatus
  type: TaskType
  priority: TaskPriority
  project?: string
  milestone?: string | null
  labels?: string[]
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
