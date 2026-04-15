import fs from 'node:fs';
import path from 'node:path';
import { parse as yamlParse } from 'yaml';
import type { SqliteIndex } from './sqlite-index.js';
import { MarkdownStore } from './markdown-store.js';
import { MilestoneRepository } from './milestone-repository.js';
import { McpTasksError } from '../types/errors.js';
import type { Milestone } from '../types/task.js';

interface MilestonesYaml {
  milestones?: Array<Partial<Milestone> & { id?: string; title?: string }>;
}

/**
 * Reconciler: syncs on-disk markdown files with the SQLite index.
 *
 * Used after manual edits to task files or after a fresh init to rebuild
 * the index from the canonical markdown source.
 */
export class Reconciler {
  private markdownStore = new MarkdownStore();
  private milestoneRepo: MilestoneRepository;

  constructor(
    private sqliteIndex: SqliteIndex,
    private tasksDir: string,
    private project: string,
    milestoneRepo?: MilestoneRepository,
  ) {
    this.milestoneRepo = milestoneRepo ?? new MilestoneRepository(sqliteIndex.getRawDb());
  }

  /**
   * Scan tasksDir, parse every .md file, upsert into SQLite.
   * Also processes milestones.yaml if present.
   * Returns count of reconciled tasks.
   */
  reconcile(): number {
    if (!fs.existsSync(this.tasksDir)) {
      throw new McpTasksError('PROJECT_NOT_FOUND', `Tasks directory not found: ${this.tasksDir}`);
    }

    // Ensure project row exists before inserting tasks (FK constraint)
    this.sqliteIndex.ensureProject(this.project);

    // Process milestones.yaml if present
    this.reconcileMilestones();

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
   * Read milestones.yaml from tasksDir and upsert each milestone into SQLite.
   * Malformed YAML or missing file is logged and skipped — never throws.
   */
  private reconcileMilestones(): void {
    const milestonesFile = path.join(this.tasksDir, 'milestones.yaml');
    if (!fs.existsSync(milestonesFile)) return;

    let parsed: MilestonesYaml;
    try {
      const raw = fs.readFileSync(milestonesFile, 'utf-8');
      parsed = yamlParse(raw) as MilestonesYaml;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[reconciler] Failed to parse milestones.yaml: ${msg}`);
      return;
    }

    if (!parsed || !Array.isArray(parsed.milestones)) {
      console.error('[reconciler] milestones.yaml has no milestones array — skipping');
      return;
    }

    for (const entry of parsed.milestones) {
      if (!entry.id || !entry.title) {
        console.error(`[reconciler] Skipping milestone entry missing id or title: ${JSON.stringify(entry)}`);
        continue;
      }

      try {
        const existing = this.milestoneRepo.getMilestone(entry.id, this.project);
        if (existing) {
          // Update if fields differ
          this.milestoneRepo.updateMilestone(entry.id, this.project, {
            title: entry.title ?? existing.title,
            description: entry.description ?? existing.description,
            due_date: entry.due_date ?? existing.due_date,
            status: entry.status ?? existing.status,
          });
        } else {
          this.milestoneRepo.createMilestone({
            id: entry.id,
            project: this.project,
            title: entry.title,
            description: entry.description,
            due_date: entry.due_date,
            status: entry.status ?? 'open',
            created: entry.created ?? new Date().toISOString(),
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[reconciler] Failed to upsert milestone ${entry.id}: ${msg}`);
      }
    }
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
