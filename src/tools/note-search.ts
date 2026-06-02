import { McpTasksError } from '../types/errors.js';
import { MAX_NOTE_SEARCH_RESULTS } from '../types/note.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'note_search';

export const description =
  `Full-text search over note bodies. Returns up to ${MAX_NOTE_SEARCH_RESULTS} matching notes.`;

export const schema = {
  type: 'object',
  properties: {
    q: { type: 'string', description: 'Search query' },
    project: { type: 'string', description: 'Limit search to a specific project' },
  },
  required: ['q'],
} as const;

interface NoteSearchRaw {
  q: unknown;
  project?: unknown;
}

interface ValidatedInput {
  q: string;
  project?: string;
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as NoteSearchRaw;
  if (typeof raw.q !== 'string' || !raw.q.trim()) {
    throw new McpTasksError('INVALID_FIELD', 'q is required and must be a non-empty string');
  }
  if (raw.project !== undefined && (typeof raw.project !== 'string' || !raw.project.trim())) {
    throw new McpTasksError('INVALID_FIELD', 'project must be a non-empty string if provided');
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const notes = ctx.notes.search(input.q, input.project);
  return ok(notes);
}
