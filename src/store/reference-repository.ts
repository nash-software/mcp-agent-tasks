import type Database from 'better-sqlite3';
import type { TaskReference } from '../types/task.js';
import { McpTasksError } from '../types/errors.js';

/**
 * ReferenceRepository: manages cross-task references in the task_references table.
 * Internal/package-private — do not use outside store/.
 */
export class ReferenceRepository {
  constructor(private db: Database.Database) {}

  addReference(from: string, to: string, refType: TaskReference['type']): void {
    if (from === to) {
      throw new McpTasksError('INVALID_FIELD', 'A task cannot reference itself');
    }
    if (this.detectCircular(from, to)) {
      throw new McpTasksError('CIRCULAR_DEPENDENCY', `Adding reference ${from}→${to} would create a cycle`);
    }
    this.db.prepare(
      'INSERT OR IGNORE INTO task_references (from_id, to_id, ref_type) VALUES (?, ?, ?)',
    ).run(from, to, refType);
  }

  getReferencesFrom(id: string): TaskReference[] {
    const rows = this.db.prepare(
      'SELECT ref_type, to_id FROM task_references WHERE from_id=?',
    ).all(id) as Array<{ ref_type: string; to_id: string }>;
    return rows.map(r => ({ type: r.ref_type as TaskReference['type'], id: r.to_id }));
  }

  getReferencesTo(id: string): Array<{ from_id: string; ref_type: TaskReference['type'] }> {
    const rows = this.db.prepare(
      'SELECT from_id, ref_type FROM task_references WHERE to_id=?',
    ).all(id) as Array<{ from_id: string; ref_type: string }>;
    return rows.map(r => ({ from_id: r.from_id, ref_type: r.ref_type as TaskReference['type'] }));
  }

  removeReferencesFor(id: string): void {
    this.db.prepare('DELETE FROM task_references WHERE from_id=?').run(id);
  }

  /**
   * BFS: returns true if adding from→to would create a cycle.
   * Checks if `from` is reachable from `to` via existing edges.
   */
  detectCircular(from: string, to: string): boolean {
    if (from === to) return true;

    const visited = new Set<string>();
    const queue = [to];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === from) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      const neighbors = this.db.prepare(
        'SELECT to_id FROM task_references WHERE from_id=?',
      ).all(current) as Array<{ to_id: string }>;

      for (const n of neighbors) {
        if (!visited.has(n.to_id)) {
          queue.push(n.to_id);
        }
      }
    }

    return false;
  }
}
