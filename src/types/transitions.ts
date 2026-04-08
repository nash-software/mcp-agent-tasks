import type { TaskStatus } from './task.js';

export const VALID_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  todo:        ['in_progress', 'blocked'],
  in_progress: ['done', 'blocked', 'todo'],
  blocked:     ['in_progress', 'todo'],
  done:        ['in_progress'],
  archived:    [],
} as const;

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (VALID_TRANSITIONS[from] as readonly TaskStatus[]).includes(to);
}
