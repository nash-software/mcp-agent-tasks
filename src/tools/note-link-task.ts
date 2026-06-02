import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'note_link_task';

export const description =
  'Link a note to a specific task. Both the note and task must exist. Overwrites any existing task link on the note.';

export const schema = {
  type: 'object',
  properties: {
    note_id: { type: 'string', description: 'Note ID (e.g. MCPAT-N-001)' },
    task_id: { type: 'string', description: 'Task ID to link (e.g. MCPAT-042)' },
  },
  required: ['note_id', 'task_id'],
} as const;

interface NoteLinkTaskRaw {
  note_id: unknown;
  task_id: unknown;
}

interface ValidatedInput {
  note_id: string;
  task_id: string;
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as NoteLinkTaskRaw;
  if (typeof raw.note_id !== 'string' || !raw.note_id.trim()) {
    throw new McpTasksError('INVALID_FIELD', 'note_id is required and must be a non-empty string');
  }
  if (typeof raw.task_id !== 'string' || !raw.task_id.trim()) {
    throw new McpTasksError('INVALID_FIELD', 'task_id is required and must be a non-empty string');
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const note = ctx.notes.linkTask(input.note_id, input.task_id);
  return ok(note);
}
