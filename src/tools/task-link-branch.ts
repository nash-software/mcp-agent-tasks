import { McpTasksError } from '../types/errors.js';
import type { GitLink } from '../types/task.js';
import type { TaskUpdateInput } from '../types/tools.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_link_branch';

export const description = 'Link a git branch to a task. Idempotent.';

export const schema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Task ID' },
    branch: { type: 'string', description: 'Branch name' },
  },
  required: ['id', 'branch'],
} as const;

interface ValidatedInput {
  id: string;
  branch: string;
}

interface UpdateWithGit extends TaskUpdateInput {
  git?: GitLink;
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw['id'] !== 'string' || !raw['id']) {
    throw new McpTasksError('INVALID_FIELD', 'id is required and must be a string');
  }
  if (typeof raw['branch'] !== 'string' || !raw['branch']) {
    throw new McpTasksError('INVALID_FIELD', 'branch is required and must be a string');
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const task = ctx.index.getTask(input.id);
  if (!task) {
    throw new McpTasksError('TASK_NOT_FOUND', `Task ${input.id} not found`);
  }

  // Idempotent: skip if branch is already set to the same value
  if (task.git.branch === input.branch) {
    return ok(task);
  }

  const updatedGit: GitLink = {
    ...task.git,
    branch: input.branch,
  };

  const updatePayload: UpdateWithGit = {
    id: input.id,
    git: updatedGit,
  };

  const updated = ctx.store.updateTask(input.id, updatePayload);
  return ok(updated);
}
