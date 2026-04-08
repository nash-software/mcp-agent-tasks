import { McpTasksError } from '../types/errors.js';
import { Reconciler } from '../store/reconciler.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_rebuild_index';

export const description =
  'Rebuild the SQLite index by re-parsing all markdown task files. Useful after manual edits or corruption.';

export const schema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Project prefix (optional, defaults to all projects in config)' },
  },
  required: [],
} as const;

interface ValidatedInput {
  project?: string;
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  // Find the tasks directory for the given project
  let tasksDir: string;
  let project: string;

  if (input.project) {
    const projectConfig = ctx.config.projects.find(p => p.prefix === input.project);
    if (!projectConfig) {
      throw new McpTasksError('PROJECT_NOT_FOUND', `Project ${input.project} not found in config`);
    }
    tasksDir = projectConfig.path;
    project = input.project;
  } else {
    // Use the default storage dir
    tasksDir = ctx.config.storageDir;
    project = ctx.config.projects[0]?.prefix ?? '';
  }

  const reconciler = new Reconciler(ctx.index, tasksDir, project);
  const count = reconciler.reconcile();

  return ok({ rebuilt: true, count });
}
