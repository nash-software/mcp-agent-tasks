import { McpTasksError } from '../types/errors.js';
import type { SubtaskEntry } from '../types/task.js';
import type { TaskUpdateInput } from '../types/tools.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_promote_subtask';

export const description =
  'Promote an inline subtask to a full task. Creates a new task file and links it as a child.';

export const schema = {
  type: 'object',
  properties: {
    parent_id: { type: 'string', description: 'Parent task ID' },
    subtask_id: { type: 'string', description: 'Subtask ID to promote (e.g. HERALD-001.2)' },
  },
  required: ['parent_id', 'subtask_id'],
} as const;

interface ValidatedInput {
  parent_id: string;
  subtask_id: string;
}

// Extended update payload that the store allows but the base type doesn't expose
interface UpdateWithChildren extends TaskUpdateInput {
  subtasks?: SubtaskEntry[];
  children?: string[];
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw['parent_id'] !== 'string' || !raw['parent_id']) {
    throw new McpTasksError('INVALID_FIELD', 'parent_id is required and must be a string');
  }
  if (typeof raw['subtask_id'] !== 'string' || !raw['subtask_id']) {
    throw new McpTasksError('INVALID_FIELD', 'subtask_id is required and must be a string');
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const parent = ctx.index.getTask(input.parent_id);
  if (!parent) {
    throw new McpTasksError('TASK_NOT_FOUND', `Task ${input.parent_id} not found`);
  }

  const subtask = parent.subtasks.find(s => s.id === input.subtask_id);
  if (!subtask) {
    throw new McpTasksError(
      'TASK_NOT_FOUND',
      `Subtask ${input.subtask_id} not found in task ${input.parent_id}`,
    );
  }

  // Depth check: parent already has a parent → depth would be 3 (grandparent > parent > child)
  // We allow max depth 3, so if parent.parent exists we are already at depth 2 and promoting adds depth 3 — allowed
  // But if parent.parent's parent exists we'd exceed depth 3
  if (parent.parent) {
    const grandparent = ctx.index.getTask(parent.parent);
    if (grandparent?.parent) {
      throw new McpTasksError('MAX_DEPTH_EXCEEDED', 'Cannot promote subtask: would exceed max task depth of 3');
    }
  }

  // Create the promoted task as a full task
  const promoted = ctx.store.createTask({
    project: parent.project,
    title: subtask.title,
    type: parent.type,
    priority: parent.priority,
    why: `Promoted from subtask ${input.subtask_id} of ${input.parent_id}`,
    parent: input.parent_id,
  });

  // Remove subtask from parent's subtasks list
  const updatedSubtasks = parent.subtasks.filter(s => s.id !== input.subtask_id);

  // Add promoted task ID to parent's children
  const updatedChildren = [...parent.children, promoted.id];

  const updatePayload: UpdateWithChildren = {
    id: input.parent_id,
    subtasks: updatedSubtasks,
    children: updatedChildren,
  };

  ctx.store.updateTask(input.parent_id, updatePayload);

  return ok({
    promoted_task_id: promoted.id,
    parent_task_id: input.parent_id,
  });
}
