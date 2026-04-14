import type Database from 'better-sqlite3';
import type { Milestone } from '../types/task.js';
import { McpTasksError } from '../types/errors.js';

interface MilestoneRow {
  id: string;
  project: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string;
  created: string;
}

function rowToMilestone(row: MilestoneRow): Milestone & { project: string } {
  return {
    id: row.id,
    project: row.project,
    title: row.title,
    description: row.description ?? undefined,
    due_date: row.due_date ?? undefined,
    status: row.status as 'open' | 'closed',
    created: row.created,
  };
}

/**
 * MilestoneRepository: CRUD on the milestones table.
 * Constructed with a raw Database handle (via SqliteIndex.getRawDb()).
 * This is an internal/package-private API — do not use outside store/.
 */
export class MilestoneRepository {
  constructor(private db: Database.Database) {}

  createMilestone(m: Milestone & { project: string }): void {
    try {
      this.db.prepare(`
        INSERT INTO milestones (id, project, title, description, due_date, status, created)
        VALUES (@id, @project, @title, @description, @due_date, @status, @created)
      `).run({
        id: m.id,
        project: m.project,
        title: m.title,
        description: m.description ?? null,
        due_date: m.due_date ?? null,
        status: m.status ?? 'open',
        created: m.created,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        throw new McpTasksError('INVALID_FIELD', `Milestone ${m.id} already exists in project ${m.project}`);
      }
      throw err;
    }
  }

  listMilestones(project?: string): Array<Milestone & { project: string }> {
    const rows = project
      ? this.db.prepare('SELECT * FROM milestones WHERE project=? ORDER BY created').all(project) as MilestoneRow[]
      : this.db.prepare('SELECT * FROM milestones ORDER BY project, created').all() as MilestoneRow[];
    return rows.map(rowToMilestone);
  }

  getMilestone(id: string, project: string): (Milestone & { project: string }) | null {
    const row = this.db.prepare(
      'SELECT * FROM milestones WHERE id=? AND project=?',
    ).get(id, project) as MilestoneRow | undefined;
    return row ? rowToMilestone(row) : null;
  }

  updateMilestone(id: string, project: string, patch: Partial<Milestone>): void {
    const existing = this.getMilestone(id, project);
    if (!existing) {
      throw new McpTasksError('TASK_NOT_FOUND', `Milestone ${id} not found in project ${project}`);
    }
    this.db.prepare(`
      UPDATE milestones SET
        title=@title,
        description=@description,
        due_date=@due_date,
        status=@status
      WHERE id=@id AND project=@project
    `).run({
      id,
      project,
      title: patch.title ?? existing.title,
      description: patch.description ?? existing.description ?? null,
      due_date: patch.due_date ?? existing.due_date ?? null,
      status: patch.status ?? existing.status,
    });
  }

  closeMilestone(id: string, project: string): void {
    this.updateMilestone(id, project, { status: 'closed' });
  }

  deleteMilestone(id: string, project: string): void {
    this.db.prepare('DELETE FROM milestones WHERE id=? AND project=?').run(id, project);
  }

  /**
   * Returns milestone IDs referenced in tasks.milestone column but absent
   * from the milestones table (for the given project).
   */
  getOrphanedMilestoneIds(project: string): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT t.milestone
      FROM tasks t
      WHERE t.project=?
        AND t.milestone IS NOT NULL
        AND t.milestone NOT IN (SELECT id FROM milestones WHERE project=?)
    `).all(project, project) as Array<{ milestone: string }>;
    return rows.map(r => r.milestone);
  }
}
