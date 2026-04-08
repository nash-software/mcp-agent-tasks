import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_stats';

export const description = 'Get task statistics: status breakdown, cycle times, completion rate.';

export const schema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Filter by project (optional)' },
  },
  required: [],
} as const;

interface ValidatedInput {
  project?: string;
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const stats = ctx.index.getStats(input.project);
  return ok(stats);
}
