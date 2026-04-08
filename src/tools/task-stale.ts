import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_stale';

export const description =
  'List tasks that are in_progress but have exceeded their claim TTL (stale tasks).';

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
  const tasks = ctx.index.getStaleTasks(input.project);
  return ok(tasks);
}
