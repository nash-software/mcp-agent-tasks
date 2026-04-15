import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok, err } from './context.js';

export const name = 'task_milestone';

export const description =
  'Manage milestones: create, list, get, update, close, or delete a milestone.';

export const schema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'list', 'get', 'update', 'close', 'delete'],
      description: 'Action to perform',
    },
    project: { type: 'string', description: 'Project prefix (required for create, get, update, close, delete)' },
    id: { type: 'string', description: 'Milestone ID (required for get, update, close, delete)' },
    title: { type: 'string', description: 'Milestone title (required for create)' },
    description: { type: 'string', description: 'Milestone description (optional)' },
    due_date: { type: 'string', description: 'Due date ISO-8601 (optional)' },
    status: { type: 'string', enum: ['open', 'closed'], description: 'Milestone status' },
  },
  required: ['action'],
} as const;

interface ValidatedInput {
  action: 'create' | 'list' | 'get' | 'update' | 'close' | 'delete';
  project?: string;
  id?: string;
  title?: string;
  description?: string;
  due_date?: string;
  status?: 'open' | 'closed';
}

const VALID_ACTIONS = new Set(['create', 'list', 'get', 'update', 'close', 'delete']);

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw['action'] !== 'string' || !VALID_ACTIONS.has(raw['action'])) {
    throw new McpTasksError('INVALID_FIELD', `action must be one of: ${[...VALID_ACTIONS].join(', ')}`);
  }
  const action = raw['action'] as ValidatedInput['action'];
  if (action === 'create') {
    if (typeof raw['project'] !== 'string' || !raw['project']) {
      throw new McpTasksError('INVALID_FIELD', 'project is required for create');
    }
    if (typeof raw['id'] !== 'string' || !raw['id']) {
      throw new McpTasksError('INVALID_FIELD', 'id is required for create');
    }
    if (typeof raw['title'] !== 'string' || !raw['title']) {
      throw new McpTasksError('INVALID_FIELD', 'title is required for create');
    }
  }
  if (action === 'get' || action === 'update' || action === 'close' || action === 'delete') {
    if (typeof raw['id'] !== 'string' || !raw['id']) {
      throw new McpTasksError('INVALID_FIELD', `id is required for ${action}`);
    }
    if (typeof raw['project'] !== 'string' || !raw['project']) {
      throw new McpTasksError('INVALID_FIELD', `project is required for ${action}`);
    }
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const repo = ctx.milestones;

  switch (input.action) {
    case 'create': {
      const now = new Date().toISOString();
      repo.createMilestone({
        id: input.id!,
        project: input.project!,
        title: input.title!,
        description: input.description,
        due_date: input.due_date,
        status: input.status ?? 'open',
        created: now,
      });
      const created = repo.getMilestone(input.id!, input.project!);
      return ok(created);
    }

    case 'list': {
      const milestones = repo.listMilestones(input.project);
      return ok(milestones);
    }

    case 'get': {
      const milestone = repo.getMilestone(input.id!, input.project!);
      if (!milestone) {
        return err('TASK_NOT_FOUND', `Milestone ${input.id} not found in project ${input.project}`);
      }
      return ok(milestone);
    }

    case 'update': {
      repo.updateMilestone(input.id!, input.project!, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.due_date !== undefined ? { due_date: input.due_date } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      });
      const updated = repo.getMilestone(input.id!, input.project!);
      return ok(updated);
    }

    case 'close': {
      repo.closeMilestone(input.id!, input.project!);
      const closed = repo.getMilestone(input.id!, input.project!);
      return ok(closed);
    }

    case 'delete': {
      repo.deleteMilestone(input.id!, input.project!);
      return ok({ deleted: true, id: input.id });
    }

    default: {
      // TypeScript exhaustiveness guard
      const _never: never = input.action;
      return err('INVALID_FIELD', `Unknown action: ${String(_never)}`);
    }
  }
}
