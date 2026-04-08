import fs from 'node:fs';
import path from 'node:path';
import type { SqliteIndex } from './sqlite-index.js';
import { MarkdownStore } from './markdown-store.js';
import { McpTasksError } from '../types/errors.js';

/**
 * Reconciler: syncs on-disk markdown files with the SQLite index.
 *
 * Used after manual edits to task files or after a fresh init to rebuild
 * the index from the canonical markdown source.
 */
export class Reconciler {
  private markdownStore = new MarkdownStore();

  constructor(
    private sqliteIndex: SqliteIndex,
    private tasksDir: string,
    private project: string,
  ) {}

  /**
   * Scan tasksDir, parse every .md file, upsert into SQLite.
   * Returns count of reconciled tasks.
   */
  reconcile(): number {
    if (!fs.existsSync(this.tasksDir)) {
      throw new McpTasksError('PROJECT_NOT_FOUND', `Tasks directory not found: ${this.tasksDir}`);
    }

    // Ensure project row exists before inserting tasks (FK constraint)
    this.sqliteIndex.ensureProject(this.project);

    const files = fs.readdirSync(this.tasksDir).filter(f => f.endsWith('.md'));
    let count = 0;

    for (const file of files) {
      const filePath = path.join(this.tasksDir, file);
      try {
        const task = this.markdownStore.read(filePath);
        if (task.project === this.project) {
          this.sqliteIndex.upsertTask(task);
          count++;
        }
      } catch (err) {
        // Skip corrupt files — log and continue
        if (err instanceof McpTasksError && err.code === 'SCHEMA_MISMATCH') {
          // Silently skip corrupt files during reconciliation
          continue;
        }
        throw err;
      }
    }

    return count;
  }

  /**
   * Remove index entries whose markdown files no longer exist on disk.
   */
  pruneOrphans(): number {
    const tasks = this.sqliteIndex.listTasks({ project: this.project, limit: 100000 });
    let count = 0;

    for (const task of tasks) {
      if (!fs.existsSync(task.file_path)) {
        this.sqliteIndex.deleteTask(task.id);
        count++;
      }
    }

    return count;
  }
}
