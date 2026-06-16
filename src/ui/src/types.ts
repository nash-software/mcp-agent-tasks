export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked' | 'archived' | 'draft' | 'approved' | 'closed'
export type TaskType = 'feature' | 'bug' | 'chore' | 'spike' | 'refactor' | 'spec' | 'plan'
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low'
export type TaskArea = 'client' | 'personal' | 'outsource' | 'internal'
export type MilestoneStatus = 'open' | 'closed'
export type GoalStatus = 'active' | 'achieved' | 'paused'

export interface Goal {
  id: string
  title: string
  description?: string
  metric?: string
  target_date?: string | null
  status: GoalStatus
  created_at: string
}

/** A reference link from one task to another (mirrors src/types/task.ts TaskReference). */
export interface TaskReference {
  type: 'closes' | 'blocks' | 'related'
  id: string
}

/** A subtask entry for display in the TaskPanel checklist (mirrors src/types/task.ts SubtaskEntry). */
export interface Subtask {
  id: string
  title: string
  status: TaskStatus
}

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
  dependencies?: string[]
  references?: TaskReference[]
  subtasks?: Subtask[]
  files?: string[]
  auto_captured?: boolean
  area?: TaskArea
  scheduled_for?: string | null
  estimate_hours?: number | null
  spec_file?: string     // epic §4 linked doc
  plan_file?: string     // epic §4 linked doc
  block_reason?: string  // epic §4 — shown when status==='blocked'
  tags?: string[]        // epic §4 alias for labels
  agent_status?: 'scheduled' | 'running' | 'done'  // P2-05: Hermes sign-off gate
  triage_note?: string   // MCPAT-069 B8: flagged-draft signal (backend already emits it)
  // P4-02: sprint-closure fields
  closed_at?: number        // epoch ms — when the batch close ran
  close_batch?: string      // batch id stamped by POST /api/tasks/close-batch
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
  source?: 'capture' | 'linked-doc'
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
  type?: 'note' | 'task'
  id?: string
}

export interface BrainSearchResponse {
  results: BrainResult[]
  query: string
  offline?: boolean
}

export type ViewId = 'today' | 'board' | 'hermes' | 'braindump' | 'artifacts' | 'roadmap' | 'activity' | 'completed' | 'notes' | 'advisor' | 'triage'

// P4-02: batch close response
export interface BatchCloseResponse {
  batch: string
  closed: number
  tasks: Task[]
  totalEstimateHours: number
}
export interface PanelState { mode: 'peek' | 'detail'; taskId: string }

// ── Phase 2 types ──────────────────────────────────────────────────────────

export type Engine = 'hermes' | 'n8n' | 'acr'

/** UI density (P3-01) — drives the [data-density] CSS-var scale.
 *  Values: compact | balanced (default, was "cozy") | airy (was "spacious").
 */
export type Density = 'compact' | 'balanced' | 'airy'

/** Skill — a reusable automation Hermes can run. */
export interface Skill {
  id: string
  name: string
  project: string
  engine: Engine
  desc: string
  match: string[]       // substrings used for title+tags matching
  runs: number
  minutesSaved: number
  lastRun: string
  origin: string
}

/** Agent log entry — what Hermes has done. */
export interface AgentLog {
  id: string
  kind: 'run' | 'research' | 'promote'
  title: string
  project: string
  savedMin: number
  at: string
  skill?: string
}

/** Automation proposal — a research result suggesting a new skill (P2-06). */
export interface Proposal {
  id: string
  taskId: string
  project: string
  skillName: string
  taskTitle: string
  summary: string
  steps: string[]
  savedPerRun: number
  frequency: string
  engine: Engine
}

/**
 * Proposal augmented with _match terms (derived at research time).
 * Used by HermesView to seed Skill.match[] on promote without an extra round-trip.
 */
export interface ProposalWithMatch extends Proposal {
  _match: string[]
}

// ── Conversational Action Cards (Phase 4) ─────────────────────────────────

export type ActionDraftType = 'create_task' | 'create_note' | 'set_milestone'
export type ActionDraftStatus = 'pending' | 'approved' | 'edited' | 'dismissed'

/** A proposed action extracted from an advisor response. Value object — not persisted unless approved. */
export interface ActionDraft {
  id: string
  type: ActionDraftType
  title: string
  project?: string
  priority?: TaskPriority
  body?: string
  source_response_id: string
  status: ActionDraftStatus
}
