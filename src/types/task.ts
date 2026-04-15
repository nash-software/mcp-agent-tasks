export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked' | 'archived' | 'draft' | 'approved';
export type TaskType = 'feature' | 'bug' | 'chore' | 'spike' | 'refactor' | 'spec' | 'plan';
export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface TaskReference {
  type: 'closes' | 'blocks' | 'related';
  id: string; // e.g. "PROJ-042"
}

export interface Milestone {
  id: string;
  title: string;
  description?: string;
  due_date?: string;
  status: 'open' | 'closed';
  created: string;
}

export interface CaptureEvent {
  tool: 'Write' | 'Edit';
  file_path: string;
  project: string;
  inferred_type: 'plan' | 'spec' | 'spike' | 'code_change' | 'skip';
  branch: string | null;
  at: string;
}

export interface CommitRef {
  sha: string;
  message: string;
  authored_at: string; // ISO-8601
}

export interface PRRef {
  number: number;
  url: string;
  title: string;
  state: 'open' | 'merged' | 'closed';
  merged_at: string | null; // ISO-8601 or null
  base_branch: string;
}

export interface GitLink {
  branch?: string;
  commits: CommitRef[];
  pr?: PRRef;
}

export interface SubtaskEntry {
  id: string;           // e.g. HERALD-042.1
  title: string;
  status: Exclude<TaskStatus, 'archived'>; // subtasks cannot be archived
}

export interface StatusTransition {
  from: TaskStatus;
  to: TaskStatus;
  at: string;           // ISO-8601
  reason?: string;
}

export interface TaskFrontmatter {
  schema_version: number;
  id: string;           // e.g. HERALD-042
  title: string;        // max 200 chars
  type: TaskType;
  status: TaskStatus;
  priority: Priority;
  project: string;      // project prefix
  tags: string[];       // max 10, each max 50 chars
  complexity: number;   // 1-10
  complexity_manual: boolean;
  why: string;          // max 1000 chars
  created: string;      // ISO-8601
  updated: string;      // ISO-8601
  last_activity: string; // ISO-8601; updated on every mutation
  claimed_by: string | null;  // SessionId or null
  claimed_at: string | null;  // ISO-8601 or null
  claim_ttl_hours: number;
  parent: string | null;      // parent task ID or null
  children: string[];          // Level 3 child task IDs
  dependencies: string[];      // task IDs that must be done before this
  subtasks: SubtaskEntry[];    // Level 2 inline subtasks (max 10)
  spec_file?: string;           // relative path from project root; only valid on spec type; max 500 chars
  plan_file?: string;           // relative path from project root; only valid on plan type; max 500 chars
  milestone?: string;           // ID referencing milestones.yaml
  estimate_hours?: number;      // planning estimate
  auto_captured?: boolean;      // true if created by passive-capture hook
  labels?: string[];            // alias for tags (backward-compat: tags still works)
  references?: TaskReference[]; // cross-refs to other tasks
  git: GitLink;
  transitions: StatusTransition[]; // capped at 100 in frontmatter
  files: string[];             // relative paths to files this task touches
}

export interface Task extends TaskFrontmatter {
  body: string;       // markdown content below frontmatter
  file_path: string;  // relative from tasks_dir, forward slashes always
}
