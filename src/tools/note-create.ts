import { McpTasksError } from '../types/errors.js';
import { MAX_NOTE_BODY_LENGTH, MAX_NOTE_TAGS } from '../types/note.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'note_create';

export const description =
  'Create a new note in a project. Notes are distinct from tasks — they capture strategic context, ideas, and thoughts with no status or lifecycle.';

export const schema = {
  type: 'object',
  properties: {
    body: {
      type: 'string',
      description: `Note body (max ${MAX_NOTE_BODY_LENGTH} characters)`,
    },
    project: {
      type: 'string',
      description: 'Project prefix (e.g. MCPAT). Defaults to GEN if not specified.',
    },
    task_id: {
      type: 'string',
      description: 'Optional task ID to link this note to',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: `Optional tags (max ${MAX_NOTE_TAGS})`,
    },
  },
  required: ['body'],
} as const;

interface NoteCreateRaw {
  body: unknown;
  project?: unknown;
  task_id?: unknown;
  tags?: unknown;
}

interface ValidatedInput {
  body: string;
  project?: string;
  task_id?: string;
  tags?: string[];
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }

  const raw = input as NoteCreateRaw;

  if (typeof raw.body !== 'string' || !raw.body.trim()) {
    throw new McpTasksError('INVALID_FIELD', 'body is required and must not be empty');
  }
  if (raw.body.length > MAX_NOTE_BODY_LENGTH) {
    throw new McpTasksError('INVALID_FIELD', `body must be ${MAX_NOTE_BODY_LENGTH} characters or fewer`);
  }
  if (raw.project !== undefined && (typeof raw.project !== 'string' || !raw.project.trim())) {
    throw new McpTasksError('INVALID_FIELD', 'project must be a non-empty string if provided');
  }
  if (raw.task_id !== undefined && (typeof raw.task_id !== 'string' || !raw.task_id.trim())) {
    throw new McpTasksError('INVALID_FIELD', 'task_id must be a non-empty string if provided');
  }
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags)) {
      throw new McpTasksError('INVALID_FIELD', 'tags must be an array');
    }
    if (raw.tags.length > MAX_NOTE_TAGS) {
      throw new McpTasksError('INVALID_FIELD', `tags must have ${MAX_NOTE_TAGS} or fewer items`);
    }
    for (const tag of raw.tags) {
      if (typeof tag !== 'string' || !tag.trim()) {
        throw new McpTasksError('INVALID_FIELD', 'each tag must be a non-empty string');
      }
    }
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const defaultProject = ctx.config.projects.find(p => p.prefix === 'GEN')?.prefix
    ?? ctx.config.projects[0]?.prefix
    ?? 'GEN';

  const note = ctx.notes.create(
    {
      body: input.body,
      project: input.project,
      task_id: input.task_id,
      tags: input.tags,
    },
    defaultProject,
  );

  return ok(note);
}
