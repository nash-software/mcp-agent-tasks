import type { Priority, TaskStatus, TaskType } from './task.js';

// Core CRUD
export interface TaskCreateInput {
  project: string;
  title: string;
  type: TaskType;
  priority: Priority;
  why: string;
  tags?: string[];
  dependencies?: string[];
  files?: string[];
  parent?: string;
  template?: string;
}

export interface TaskCreateOutput {
  id: string;
  file: string;
  status: 'todo';
}

export interface TaskUpdateInput {
  id: string;
  title?: string;
  priority?: Priority;
  why?: string;
  tags?: string[];
  files?: string[];
  complexity?: number;
}

export interface TaskGetInput { id: string; }

export interface TaskListInput {
  project?: string;
  status?: TaskStatus;
  type?: TaskType;
  priority?: Priority;
  tag?: string;
  parent?: string;
  limit?: number;
}

export interface TaskDeleteInput { id: string; }

export interface TaskSearchInput {
  query: string;
  project?: string;
}

// Workflow
export type TaskNextOutput =
  | { id: string; title: string; type: TaskType; priority: Priority; complexity: number; why: string; file: string }
  | { none: true; reason: 'no_ready_tasks' | 'all_claimed' | 'all_blocked' };

export interface TaskClaimInput { id: string; }
export type TaskClaimOutput =
  | { claimed: true; session_id: string; expires_at: string }
  | { claimed: false; reason: 'already_claimed'; claimed_by: string; expires_at: string };

export interface TaskReleaseInput { id: string; }

export interface TaskTransitionInput {
  id: string;
  to_status: TaskStatus;
  reason?: string;
}

export interface TaskPromoteSubtaskInput {
  parent_id: string;
  subtask_id: string;
}

export interface TaskAddSubtaskInput {
  parent_id: string;
  title: string;
}

// Git integration
export interface TaskLinkCommitInput {
  id: string;
  sha: string;
  message: string;
  authored_at?: string;
}

export interface TaskLinkPrInput {
  id: string;
  pr_number: number;
  pr_url: string;
  pr_state: 'open' | 'merged' | 'closed';
  pr_title?: string;
  base_branch?: string;
  merged_at?: string;
}

export interface TaskLinkBranchInput {
  id: string;
  branch: string;
}

// Query/analytics
export interface TaskBlockedByInput { id: string; }
export interface TaskUnblocksInput { id: string; }
export interface TaskStaleInput { project?: string; }
export interface TaskStatsInput { project?: string; }

export interface TaskStatsOutput {
  by_status: Record<TaskStatus, number>;
  avg_cycle_time_by_type: Record<string, number | null>; // hours
  completion_rate: number; // 0-1
  stale_count: number;
}

// Admin
export interface TaskInitInput {
  project_prefix: string;
  project_path: string;
  storage_mode?: 'global' | 'local';
}

export interface TaskRebuildIndexInput { project?: string; }
export interface TaskRegisterProjectInput {
  prefix: string;
  path: string;
  storage?: 'global' | 'local';
}
