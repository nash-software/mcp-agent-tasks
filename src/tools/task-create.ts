import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_create';

export const description =
  'Create a new task in a project. Returns the created task with its assigned ID.';

export const schema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Project prefix (e.g. HERALD)' },
    title: { type: 'string', description: 'Task title (max 200 chars)' },
    type: {
      type: 'string',
      enum: ['feature', 'bug', 'chore', 'spike', 'refactor', 'spec'],
      description: 'Task type',
    },
    priority: {
      type: 'string',
      enum: ['critical', 'high', 'medium', 'low'],
      description: 'Task priority',
    },
    why: { type: 'string', description: 'Rationale for the task (max 1000 chars)' },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional tags (max 10)',
    },
    dependencies: {
      type: 'array',
      items: { type: 'string' },
      description: 'Task IDs that must be done before this one',
    },
    files: {
      type: 'array',
      items: { type: 'string' },
      description: 'Relative paths to files this task touches',
    },
    parent: { type: 'string', description: 'Parent task ID' },
    template: { type: 'string', description: 'Template name' },
    spec_file: { type: 'string', description: 'Path to spec markdown file, relative to project root (spec type only, max 500 chars)' },
  },
  required: ['project', 'title', 'type', 'priority', 'why'],
} as const;

interface TaskCreateRaw {
  project: unknown;
  title: unknown;
  type: unknown;
  priority: unknown;
  why: unknown;
  tags?: unknown;
  dependencies?: unknown;
  files?: unknown;
  parent?: unknown;
  template?: unknown;
  spec_file?: unknown;
}

interface ValidatedInput {
  project: string;
  title: string;
  type: 'feature' | 'bug' | 'chore' | 'spike' | 'refactor' | 'spec';
  priority: 'critical' | 'high' | 'medium' | 'low';
  why: string;
  tags?: string[];
  dependencies?: string[];
  files?: string[];
  parent?: string;
  template?: string;
  spec_file?: string;
}

const VALID_TYPES = new Set(['feature', 'bug', 'chore', 'spike', 'refactor', 'spec']);
const VALID_PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }

  const raw = input as TaskCreateRaw;

  if (typeof raw.project !== 'string' || !raw.project) {
    throw new McpTasksError('INVALID_FIELD', 'project is required and must be a string');
  }
  if (typeof raw.title !== 'string' || !raw.title) {
    throw new McpTasksError('INVALID_FIELD', 'title is required and must be a string');
  }
  if (raw.title.length > 200) {
    throw new McpTasksError('INVALID_FIELD', 'title must be 200 characters or fewer');
  }
  if (typeof raw.why !== 'string' || !raw.why) {
    throw new McpTasksError('INVALID_FIELD', 'why is required and must be a string');
  }
  if (raw.why.length > 1000) {
    throw new McpTasksError('INVALID_FIELD', 'why must be 1000 characters or fewer');
  }
  if (typeof raw.type !== 'string' || !VALID_TYPES.has(raw.type)) {
    throw new McpTasksError('INVALID_FIELD', `type must be one of: ${[...VALID_TYPES].join(', ')}`);
  }
  if (typeof raw.priority !== 'string' || !VALID_PRIORITIES.has(raw.priority)) {
    throw new McpTasksError(
      'INVALID_FIELD',
      `priority must be one of: ${[...VALID_PRIORITIES].join(', ')}`,
    );
  }
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags)) {
      throw new McpTasksError('INVALID_FIELD', 'tags must be an array');
    }
    if (raw.tags.length > 10) {
      throw new McpTasksError('INVALID_FIELD', 'tags must have 10 or fewer items');
    }
  }
  if (raw.spec_file !== undefined) {
    if (typeof raw.spec_file !== 'string') {
      throw new McpTasksError('INVALID_FIELD', 'spec_file must be a string');
    }
    if (raw.type !== 'spec') {
      throw new McpTasksError('INVALID_FIELD', "spec_file is only valid for type 'spec'");
    }
    if (raw.spec_file.length > 500) {
      throw new McpTasksError('INVALID_FIELD', 'spec_file must be 500 characters or fewer');
    }
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const task = ctx.store.createTask(input);
  return ok(task);
}
