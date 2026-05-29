import type { Area } from '../types/task.js';
import type { GlobalConfig } from '../types/config.js';

/**
 * Resolves the effective PARA area for a task using three-level precedence:
 * 1. Explicit `area` on the task itself
 * 2. Config `areas` map keyed by project prefix
 * 3. Final fallback: 'internal'
 */
export function resolveArea(
  taskArea: Area | undefined,
  project: string,
  config: Pick<GlobalConfig, 'areas'>,
): Area {
  if (taskArea !== undefined) return taskArea;
  const mapped = config.areas?.[project];
  if (mapped !== undefined) return mapped;
  return 'internal';
}
