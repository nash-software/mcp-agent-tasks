import { McpTasksError } from '../types/errors.js';
import type { GitLink, PRRef } from '../types/task.js';
import type { TaskUpdateInput } from '../types/tools.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_link_pr';

export const description =
  'Link a pull request to a task. If pr_state is merged, auto-transitions the task to done.';

export const schema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Task ID' },
    pr_number: { type: 'number', description: 'PR number' },
    pr_url: { type: 'string', description: 'PR URL' },
    pr_state: {
      type: 'string',
      enum: ['open', 'merged', 'closed'],
      description: 'PR state',
    },
    pr_title: { type: 'string', description: 'PR title' },
    base_branch: { type: 'string', description: 'Base branch name' },
    merged_at: { type: 'string', description: 'ISO-8601 merge timestamp' },
  },
  required: ['id', 'pr_number', 'pr_url', 'pr_state'],
} as const;

interface ValidatedInput {
  id: string;
  pr_number: number;
  pr_url: string;
  pr_state: 'open' | 'merged' | 'closed';
  pr_title?: string;
  base_branch?: string;
  merged_at?: string;
}

interface UpdateWithGit extends TaskUpdateInput {
  git?: GitLink;
}

const VALID_PR_STATES = new Set(['open', 'merged', 'closed']);

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw['id'] !== 'string' || !raw['id']) {
    throw new McpTasksError('INVALID_FIELD', 'id is required and must be a string');
  }
  if (typeof raw['pr_number'] !== 'number') {
    throw new McpTasksError('INVALID_FIELD', 'pr_number is required and must be a number');
  }
  if (typeof raw['pr_url'] !== 'string' || !raw['pr_url']) {
    throw new McpTasksError('INVALID_FIELD', 'pr_url is required and must be a string');
  }
  if (typeof raw['pr_state'] !== 'string' || !VALID_PR_STATES.has(raw['pr_state'])) {
    throw new McpTasksError('INVALID_FIELD', `pr_state must be one of: ${[...VALID_PR_STATES].join(', ')}`);
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const task = ctx.index.getTask(input.id);
  if (!task) {
    throw new McpTasksError('TASK_NOT_FOUND', `Task ${input.id} not found`);
  }

  const pr: PRRef = {
    number: input.pr_number,
    url: input.pr_url,
    title: input.pr_title ?? '',
    state: input.pr_state,
    merged_at: input.merged_at ?? null,
    base_branch: input.base_branch ?? '',
  };

  const updatedGit: GitLink = {
    ...task.git,
    pr,
  };

  const updatePayload: UpdateWithGit = {
    id: input.id,
    git: updatedGit,
  };

  let updated = ctx.store.updateTask(input.id, updatePayload);

  // Auto-transition to done if PR was merged and task is not already done/archived
  if (input.pr_state === 'merged' && updated.status !== 'done' && updated.status !== 'archived') {
    try {
      updated = ctx.store.transitionTask(input.id, 'done', 'PR merged');
    } catch {
      // If transition fails (e.g. invalid from current state), skip silently
    }
  }

  return ok(updated);
}
