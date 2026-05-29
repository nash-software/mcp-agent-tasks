export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked' | 'archived' | 'draft' | 'approved'
export type TaskType = 'feature' | 'bug' | 'chore' | 'spike' | 'refactor' | 'spec' | 'plan'
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low'
export type TaskArea = 'client' | 'personal' | 'outsource' | 'internal'
export type MilestoneStatus = 'open' | 'closed'

export interface GitPr {
  number: number
  url?: string
  state: 'open' | 'closed' | 'merged'
}

export interface GitInfo {
  branch?: string
  pr?: GitPr
  commits?: string[]   // short SHAs — epic §4 git.commits[]
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
  area?: TaskArea
  scheduled_for?: string | null
  estimate_hours?: number | null
  spec_file?: string     // epic §4 linked doc
  plan_file?: string     // epic §4 linked doc
  block_reason?: string  // epic §4 — shown when status==='blocked'
  tags?: string[]        // epic §4 alias for labels
}

export interface TodayCapacity {
  committedMinutes: number
  targetMinutes: number
}

export interface TodayResponse {
  committed: Task[]
  candidates: Task[]
  capacity: TodayCapacity
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

export interface ArtifactEntry {
  path: string
  project: string
  created_at: string
  last_opened_at: string | null
  task_id: string | null
  staleDays: number
}

export interface AcrJob {
  id: string
  title: string
  status: 'pending' | 'running' | 'done' | 'failed'
  project?: string
  elapsed_s?: number
  error?: string
  hermes?: boolean   // P2-06: Hermes-dispatched badge (leave room, no render yet)
}

export interface AcrStatusResponse {
  offline: boolean
  jobs: AcrJob[]
}

export interface BrainResult {
  title: string
  snippet: string
  source?: string
}

export interface BrainSearchResponse {
  results: BrainResult[]
  query: string
  offline?: boolean
}

export type ViewId = 'today' | 'board' | 'hermes' | 'braindump' | 'artifacts' | 'roadmap' | 'activity'
export interface PanelState { mode: 'peek' | 'detail'; taskId: string }
