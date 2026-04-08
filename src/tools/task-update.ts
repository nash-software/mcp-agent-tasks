import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_update';

export const description =
  'Update mutable fields of an existing task. Status changes must use task_transition instead.';

export const schema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Task ID' },
    title: { type: 'string', description: 'New title (max 200 chars)' },
    priority: {
      type: 'string',
      enum: ['critical', 'high', 'medium', 'low'],
    },
    why: { type: 'string', description: 'Updated rationale (max 1000 chars)' },
    tags: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    complexity: { type: 'number', minimum: 1, maximum: 10 },
  },
  required: ['id'],
} as const;

interface ValidatedInput {
  id: string;
  title?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  why?: string;
  tags?: string[];
  files?: string[];
  complexity?: number;
}

const VALID_PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as Record<string, unknown>;

  if (typeof raw['id'] !== 'string' || !raw['id']) {
    throw new McpTasksError('INVALID_FIELD', 'id is required and must be a string');
  }
  if (raw['title'] !== undefined) {
    if (typeof raw['title'] !== 'string') {
      throw new McpTasksError('INVALID_FIELD', 'title must be a string');
    }
    if (raw['title'].length > 200) {
      throw new McpTasksError('INVALID_FIELD', 'title must be 200 characters or fewer');
    }
  }
  if (raw['why'] !== undefined) {
    if (typeof raw['why'] !== 'string') {
      throw new McpTasksError('INVALID_FIELD', 'why must be a string');
    }
    if (raw['why'].length > 1000) {
      throw new McpTasksError('INVALID_FIELD', 'why must be 1000 characters or fewer');
    }
  }
  if (raw['priority'] !== undefined) {
    if (typeof raw['priority'] !== 'string' || !VALID_PRIORITIES.has(raw['priority'])) {
      throw new McpTasksError(
        'INVALID_FIELD',
        `priority must be one of: ${[...VALID_PRIORITIES].join(', ')}`,
      );
    }
  }
  if (raw['tags'] !== undefined && !Array.isArray(raw['tags'])) {
    throw new McpTasksError('INVALID_FIELD', 'tags must be an array');
  }
  if (raw['files'] !== undefined && !Array.isArray(raw['files'])) {
    throw new McpTasksError('INVALID_FIELD', 'files must be an array');
  }
  if (raw['complexity'] !== undefined) {
    if (typeof raw['complexity'] !== 'number' || raw['complexity'] < 1 || raw['complexity'] > 10) {
      throw new McpTasksError('INVALID_FIELD', 'complexity must be a number between 1 and 10');
    }
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const task = ctx.store.updateTask(input.id, input);
  return ok(task);
}
