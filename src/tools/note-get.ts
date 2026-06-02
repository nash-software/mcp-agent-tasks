import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'note_get';

export const description = 'Get a note by ID.';

export const schema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Note ID (e.g. MCPAT-N-001)' },
  },
  required: ['id'],
} as const;

interface NoteGetRaw {
  id: unknown;
}

interface ValidatedInput {
  id: string;
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as NoteGetRaw;
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    throw new McpTasksError('INVALID_FIELD', 'id is required and must be a non-empty string');
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const note = ctx.notes.get(input.id);
  return ok(note);
}
