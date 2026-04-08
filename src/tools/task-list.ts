import { McpTasksError } from '../types/errors.js';
import type { TaskStatus, Priority } from '../types/task.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_list';

export const description = 'List tasks with optional filters.';

export const schema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Filter by project prefix' },
    status: {
      type: 'string',
      enum: ['todo', 'in_progress', 'done', 'blocked', 'archived'],
      description: 'Filter by status',
    },
    priority: {
      type: 'string',
      enum: ['critical', 'high', 'medium', 'low'],
      description: 'Filter by priority',
    },
    limit: { type: 'number', minimum: 1, maximum: 500, description: 'Max results (default 50)' },
  },
  required: [],
} as const;

interface ValidatedInput {
  project?: string;
  status?: TaskStatus;
  priority?: Priority;
  limit?: number;
}

const VALID_STATUSES = new Set(['todo', 'in_progress', 'done', 'blocked', 'archived']);
const VALID_PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as Record<string, unknown>;

  if (raw['status'] !== undefined && (typeof raw['status'] !== 'string' || !VALID_STATUSES.has(raw['status']))) {
    throw new McpTasksError('INVALID_FIELD', `status must be one of: ${[...VALID_STATUSES].join(', ')}`);
  }
  if (raw['priority'] !== undefined && (typeof raw['priority'] !== 'string' || !VALID_PRIORITIES.has(raw['priority']))) {
    throw new McpTasksError('INVALID_FIELD', `priority must be one of: ${[...VALID_PRIORITIES].join(', ')}`);
  }
  if (raw['limit'] !== undefined && (typeof raw['limit'] !== 'number' || raw['limit'] < 1)) {
    throw new McpTasksError('INVALID_FIELD', 'limit must be a positive number');
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const tasks = ctx.index.listTasks({
    project: input.project,
    status: input.status,
    priority: input.priority,
    limit: input.limit ?? 50,
  });
  return ok(tasks);
}
