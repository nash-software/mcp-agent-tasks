import { McpTasksError } from '../types/errors.js';
import type { SubtaskEntry } from '../types/task.js';
import type { TaskUpdateInput } from '../types/tools.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_add_subtask';

export const description = 'Add an inline subtask to a parent task (max 10 subtasks per task).';

export const schema = {
  type: 'object',
  properties: {
    parent_id: { type: 'string', description: 'Parent task ID' },
    title: { type: 'string', description: 'Subtask title (max 200 chars)' },
  },
  required: ['parent_id', 'title'],
} as const;

interface ValidatedInput {
  parent_id: string;
  title: string;
}

// Extended update payload that the store allows but the base type doesn't expose
interface UpdateWithSubtasks extends TaskUpdateInput {
  subtasks?: SubtaskEntry[];
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw['parent_id'] !== 'string' || !raw['parent_id']) {
    throw new McpTasksError('INVALID_FIELD', 'parent_id is required and must be a string');
  }
  if (typeof raw['title'] !== 'string' || !raw['title']) {
    throw new McpTasksError('INVALID_FIELD', 'title is required and must be a string');
  }
  if (raw['title'].length > 200) {
    throw new McpTasksError('INVALID_FIELD', 'title must be 200 characters or fewer');
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const parent = ctx.index.getTask(input.parent_id);
  if (!parent) {
    throw new McpTasksError('TASK_NOT_FOUND', `Task ${input.parent_id} not found`);
  }

  if (parent.subtasks.length >= 10) {
    throw new McpTasksError('INVALID_FIELD', 'Maximum 10 subtasks per task');
  }

  const n = parent.subtasks.length + 1;
  const subtaskId = `${input.parent_id}.${n}`;

  const updatedSubtasks: SubtaskEntry[] = [
    ...parent.subtasks,
    { id: subtaskId, title: input.title, status: 'todo' },
  ];

  const updatePayload: UpdateWithSubtasks = {
    id: input.parent_id,
    subtasks: updatedSubtasks,
  };

  const updated = ctx.store.updateTask(input.parent_id, updatePayload);
  return ok(updated);
}
