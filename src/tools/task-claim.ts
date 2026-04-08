import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_claim';

export const description =
  'Claim a task for this session. Prevents other sessions from picking the same task.';

export const schema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Task ID to claim' },
    ttl_hours: { type: 'number', minimum: 0.5, maximum: 72, description: 'Claim TTL in hours (default 4)' },
  },
  required: ['id'],
} as const;

interface ValidatedInput {
  id: string;
  ttl_hours?: number;
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw['id'] !== 'string' || !raw['id']) {
    throw new McpTasksError('INVALID_FIELD', 'id is required and must be a string');
  }
  if (raw['ttl_hours'] !== undefined && typeof raw['ttl_hours'] !== 'number') {
    throw new McpTasksError('INVALID_FIELD', 'ttl_hours must be a number');
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const result = ctx.store.claimTask(input.id, ctx.sessionId, input.ttl_hours);
  return ok({ claimed: result.claimed, task: result.task });
}
