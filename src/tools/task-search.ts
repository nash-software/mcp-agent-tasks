import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_search';

export const description = 'Full-text search across tasks using SQLite FTS5.';

export const schema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Search query' },
    project: { type: 'string', description: 'Limit search to a specific project' },
  },
  required: ['query'],
} as const;

interface ValidatedInput {
  query: string;
  project?: string;
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw['query'] !== 'string' || !raw['query']) {
    throw new McpTasksError('INVALID_FIELD', 'query is required and must be a string');
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const tasks = ctx.index.searchTasks(input.query);
  // If project filter provided, apply post-filter (index.searchTasks doesn't accept project param)
  const filtered = input.project ? tasks.filter(t => t.project === input.project) : tasks;
  return ok(filtered);
}
