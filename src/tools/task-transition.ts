import { McpTasksError } from '../types/errors.js';
import type { TaskStatus } from '../types/task.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_transition';

export const description = 'Transition a task to a new status.';

export const schema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Task ID' },
    to_status: {
      type: 'string',
      enum: ['todo', 'in_progress', 'done', 'blocked'],
      description: 'Target status',
    },
    reason: { type: 'string', description: 'Optional reason for the transition' },
  },
  required: ['id', 'to_status'],
} as const;

interface ValidatedInput {
  id: string;
  to_status: TaskStatus;
  reason?: string;
}

const VALID_STATUSES = new Set(['todo', 'in_progress', 'done', 'blocked']);

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw['id'] !== 'string' || !raw['id']) {
    throw new McpTasksError('INVALID_FIELD', 'id is required and must be a string');
  }
  if (typeof raw['to_status'] !== 'string' || !VALID_STATUSES.has(raw['to_status'])) {
    throw new McpTasksError('INVALID_FIELD', `to_status must be one of: ${[...VALID_STATUSES].join(', ')}`);
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const task = ctx.store.transitionTask(input.id, input.to_status, input.reason);
  return ok(task);
}
