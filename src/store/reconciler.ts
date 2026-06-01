import fs from 'node:fs';
import path from 'node:path';
import { parse as yamlParse } from 'yaml';
import { SqliteIndex } from './sqlite-index.js';
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
export interface IdCollision {
  id: string;
  files: string[];
}

export class Reconciler {
  private markdownStore = new MarkdownStore();
  private milestoneRepo: MilestoneRepository;
  /** (id, project) collisions detected on the most recent reconcile() pass. */
  private collisions: IdCollision[] = [];

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
    let changed = 0;
    let skipped = 0;
    this.collisions = [];
    const seenIds = new Map<string, string>();
    const seenHash = new Map<string, string>();

    for (const file of files) {
      const filePath = path.join(this.tasksDir, file);
      try {
        const task = this.markdownStore.read(filePath);
        if (task.project !== this.project) continue;

        // Hash the raw file (frontmatter + body) once — reused for both collision detection and the
        // incremental-skip check below. Hashing the whole file (not just the body) ensures frontmatter
        // edits are never falsely skipped (MCPAT-049 F1).
        const fileHash = SqliteIndex.hashBody(fs.readFileSync(filePath, 'utf-8'));

        // Detect (id, project) collisions: two DIFFERENT-content files claiming the same id. The index
        // PK is (id, project), so the last one upserted silently wins — surface a warning instead of
        // failing silently (MCPAT-060). Identical-content duplicates reconcile to the same row, so they
        // are not flagged.
        const prevFile = seenIds.get(task.id);
        if (prevFile && prevFile !== filePath) {
          if (seenHash.get(task.id) !== fileHash) {
            const existing = this.collisions.find(c => c.id === task.id);
            if (existing) {
              if (!existing.files.includes(filePath)) existing.files.push(filePath);
            } else {
              this.collisions.push({ id: task.id, files: [prevFile, filePath] });
            }
            console.error(`[reconciler] ID COLLISION: ${task.id} (${this.project}) — ${prevFile} & ${filePath}; last-write-wins. Run 'agent-tasks fix-id-collisions'.`);
          }
        } else {
          seenIds.set(task.id, filePath);
          seenHash.set(task.id, fileHash);
        }

        const storedHash = this.sqliteIndex.getBodyHash(task.id);
        if (storedHash !== null && storedHash === fileHash) {
          count++;
          continue;
        }

        this.sqliteIndex.upsertTask(task, fileHash);
        count++;
        changed++;
      } catch (err) {
        // Per-file resilience: skip ANY file that fails to ingest (corrupt frontmatter, schema mismatch,
        // invalid enum/CHECK-constraint, etc.) and continue — one bad markdown file must never abort the
        // whole project's reconcile (MCPAT-065; codex r2 F1). Systemic safety lives at the boundary, not
        // here: reconcileIndexOnBoot's outer try/catch keeps the last-known index, and pruneOrphans is
        // MARKDOWN-driven (it removes only ids with no markdown file) so a pass that ingests nothing can
        // never delete markdown-backed rows. The skip count is surfaced below for observability (codex r1).
        skipped++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[reconciler] SKIPPED ${file} (${this.project}): ${msg}`);
        continue;
      }
    }

    if (skipped > 0) {
      console.error(`[reconciler] ${this.project}: skipped ${skipped} of ${files.length} file(s) during reconcile (see SKIPPED lines above)`);
    }

    // After processing tasks, reset FTS5 shadow tables only when at least one
    // task actually changed — avoids unnecessary FTS churn on no-op reconciles.
    if (changed >= 1) {
      this.sqliteIndex.rebuildFts();
    }

    return count;
  }

  /** (id, project) collisions detected on the most recent reconcile() pass (empty when clean). */
  getCollisions(): IdCollision[] {
    return this.collisions;
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
