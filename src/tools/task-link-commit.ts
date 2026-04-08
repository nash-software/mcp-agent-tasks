import { McpTasksError } from '../types/errors.js';
import type { GitLink } from '../types/task.js';
import type { TaskUpdateInput } from '../types/tools.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_link_commit';

export const description = 'Link a git commit to a task. Idempotent by SHA.';

export const schema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Task ID' },
    sha: { type: 'string', description: 'Commit SHA' },
    message: { type: 'string', description: 'Commit message' },
    authored_at: { type: 'string', description: 'ISO-8601 authored timestamp (defaults to now)' },
  },
  required: ['id', 'sha', 'message'],
} as const;

interface ValidatedInput {
  id: string;
  sha: string;
  message: string;
  authored_at?: string;
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
  if (typeof raw['sha'] !== 'string' || !raw['sha']) {
    throw new McpTasksError('INVALID_FIELD', 'sha is required and must be a string');
  }
  if (typeof raw['message'] !== 'string' || !raw['message']) {
    throw new McpTasksError('INVALID_FIELD', 'message is required and must be a string');
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const task = ctx.index.getTask(input.id);
  if (!task) {
    throw new McpTasksError('TASK_NOT_FOUND', `Task ${input.id} not found`);
  }

  // Idempotent: skip if SHA already linked
  const alreadyLinked = task.git.commits.some(c => c.sha === input.sha);
  if (alreadyLinked) {
    return ok(task);
  }

  const updatedGit: GitLink = {
    ...task.git,
    commits: [
      ...task.git.commits,
      {
        sha: input.sha,
        message: input.message,
        authored_at: input.authored_at ?? new Date().toISOString(),
      },
    ],
  };

  const updatePayload: UpdateWithGit = {
    id: input.id,
    git: updatedGit,
  };

  const updated = ctx.store.updateTask(input.id, updatePayload);
  return ok(updated);
}
