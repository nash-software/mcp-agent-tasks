import { McpTasksError } from '../types/errors.js';
import { DEFAULT_NOTE_LIST_LIMIT, MAX_NOTE_LIST_LIMIT } from '../types/note.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'note_list';

export const description =
  'List notes, optionally filtered by project and/or linked task. Returns notes sorted by creation date, newest first.';

export const schema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Filter by project prefix' },
    task_id: { type: 'string', description: 'Filter by linked task ID' },
    limit: {
      type: 'number',
      description: `Max results (default ${DEFAULT_NOTE_LIST_LIMIT}, max ${MAX_NOTE_LIST_LIMIT})`,
    },
  },
  required: [],
} as const;

interface NoteListRaw {
  project?: unknown;
  task_id?: unknown;
  limit?: unknown;
}

interface ValidatedInput {
  project?: string;
  task_id?: string;
  limit?: number;
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as NoteListRaw;
  if (raw.project !== undefined && (typeof raw.project !== 'string' || !raw.project.trim())) {
    throw new McpTasksError('INVALID_FIELD', 'project must be a non-empty string if provided');
  }
  if (raw.task_id !== undefined && (typeof raw.task_id !== 'string' || !raw.task_id.trim())) {
    throw new McpTasksError('INVALID_FIELD', 'task_id must be a non-empty string if provided');
  }
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== 'number' || !Number.isInteger(raw.limit) || raw.limit < 1) {
      throw new McpTasksError('INVALID_FIELD', 'limit must be a positive integer if provided');
    }
    if (raw.limit > MAX_NOTE_LIST_LIMIT) {
      throw new McpTasksError('INVALID_FIELD', `limit must be ${MAX_NOTE_LIST_LIMIT} or fewer`);
    }
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const notes = ctx.notes.list({
    project: input.project,
    task_id: input.task_id,
    limit: input.limit,
  });
  return ok(notes);
}
