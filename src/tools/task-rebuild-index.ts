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
  if (input.project) {
    if (!ctx.config.projects.some(p => p.prefix === input.project)) {
      throw new McpTasksError('PROJECT_NOT_FOUND', `Project ${input.project} not found in config`);
    }
    const count = reconcileProject(ctx, input.project);
    return ok({ rebuilt: true, count, projects: { [input.project]: count } });
  }

  // No project → reconcile EVERY configured project against its own (storage-aware) dir + prefix. Global
  // projects share storageDir; reconciling it once per prefix keeps each prefix's tasks correctly filtered.
  const projects: Record<string, number> = {};
  let count = 0;
  for (const p of ctx.config.projects) {
    const c = reconcileProject(ctx, p.prefix);
    projects[p.prefix] = c;
    count += c;
  }
  return ok({ rebuilt: true, count, projects });
}

/**
 * Reconcile one project into the shared index, resolving its tasks dir storage-aware (global → storageDir,
 * local → <path>/<tasksDirName>) via the registry. MCPAT-062: the old code hard-coded join(path,
 * tasksDirName) for every project, so global-storage projects (markdown in storageDir) reconciled an empty
 * dir → count 0.
 */
function reconcileProject(ctx: ToolContext, prefix: string): number {
  const tasksDir = ctx.store.getTasksDirForPrefix(prefix);
  return new Reconciler(ctx.index, tasksDir, prefix).reconcile();
}
