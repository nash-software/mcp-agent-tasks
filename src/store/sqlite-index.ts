import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Task, TaskStatus, Priority, SubtaskEntry, StatusTransition, CommitRef, GitLink } from '../types/task.js';
import type { TaskStatsOutput } from '../types/tools.js';
import { McpTasksError } from '../types/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TaskRow {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  project: string;
  complexity: number | null;
  complexity_manual: number;
  why: string | null;
  parent: string | null;
  created: string;
  updated: string;
  last_activity: string;
  claimed_by: string | null;
  claimed_at: string | null;
  claim_ttl_hours: number;
  branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: string | null;
  pr_title: string | null;
  pr_merged_at: string | null;
  pr_base_branch: string | null;
  file_path: string;
  body: string | null;
  body_hash: string | null;
  schema_version: number;
  spec_file: string | null;
}

interface SubtaskRow {
  id: string;
  parent_id: string;
  title: string;
  status: string;
  sort_order: number;
}

interface TransitionRow {
  id: number;
  task_id: string;
  from_status: string;
  to_status: string;
  at: string;
  reason: string | null;
}

interface CommitRow {
  sha: string;
  task_id: string;
  message: string;
  authored_at: string;
}

interface ChildRow {
  parent_id: string;
  child_id: string;
}

interface TagRow {
  task_id: string;
  tag: string;
}

interface DependencyRow {
  task_id: string;
  depends_on: string;
}

interface StatsRow {
  status: string;
  count: number;
}

interface ClaimChanges {
  changes: number;
}

export class SqliteIndex {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
  }

  init(): void {
    // better-sqlite3 db.exec() supports multi-statement SQL natively,
    // including trigger bodies that contain semicolons.
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schemaSql);

    // Migration: add spec_file column to existing databases.
    // Fresh databases get it from schema.sql above; existing ones need ALTER TABLE.
    // SQLite serialises writes — concurrent init() calls are safe via try/catch.
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN spec_file TEXT');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('duplicate column name')) {
        throw err;
      }
      // 'duplicate column name: spec_file' means column already exists — expected on re-init
    }
  }

  private rowToTask(row: TaskRow): Task {
    const subtasks = (
      this.db.prepare<string>('SELECT * FROM subtasks WHERE parent_id=? ORDER BY sort_order').all(row.id) as SubtaskRow[]
    ).map(s => ({
      id: s.id,
      title: s.title,
      status: s.status as SubtaskEntry['status'],
    }));

    const dependencies = (
      this.db.prepare<string>('SELECT depends_on FROM dependencies WHERE task_id=?').all(row.id) as DependencyRow[]
    ).map(d => d.depends_on);

    const tags = (
      this.db.prepare<string>('SELECT tag FROM tags WHERE task_id=?').all(row.id) as TagRow[]
    ).map(t => t.tag);

    const transitions = (
      this.db.prepare<string>('SELECT * FROM transitions WHERE task_id=? ORDER BY id').all(row.id) as TransitionRow[]
    ).map(t => ({
      from: t.from_status as TaskStatus,
      to: t.to_status as TaskStatus,
      at: t.at,
      reason: t.reason ?? undefined,
    } as StatusTransition));

    const commits = (
      this.db.prepare<string>('SELECT * FROM commits WHERE task_id=? ORDER BY authored_at').all(row.id) as CommitRow[]
    ).map(c => ({
      sha: c.sha,
      message: c.message,
      authored_at: c.authored_at,
    } as CommitRef));

    const children = (
      this.db.prepare<string>('SELECT child_id FROM children WHERE parent_id=?').all(row.id) as ChildRow[]
    ).map(c => c.child_id);

    const git: GitLink = {
      commits,
    };
    if (row.branch) git.branch = row.branch;
    if (row.pr_number !== null && row.pr_url && row.pr_state) {
      git.pr = {
        number: row.pr_number,
        url: row.pr_url,
        title: row.pr_title ?? '',
        state: row.pr_state as 'open' | 'merged' | 'closed',
        merged_at: row.pr_merged_at,
        base_branch: row.pr_base_branch ?? '',
      };
    }

    return {
      schema_version: row.schema_version,
      id: row.id,
      title: row.title,
      type: row.type as Task['type'],
      status: row.status as TaskStatus,
      priority: row.priority as Priority,
      project: row.project,
      tags,
      complexity: row.complexity ?? 1,
      complexity_manual: row.complexity_manual === 1,
      why: row.why ?? '',
      created: row.created,
      updated: row.updated,
      last_activity: row.last_activity,
      claimed_by: row.claimed_by,
      claimed_at: row.claimed_at,
      claim_ttl_hours: row.claim_ttl_hours,
      parent: row.parent,
      children,
      dependencies,
      subtasks,
      git,
      transitions,
      files: [],
      body: row.body ?? '',
      file_path: row.file_path,
      ...(row.spec_file !== null ? { spec_file: row.spec_file } : {}),
    };
  }

  upsertTask(task: Task): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO tasks (
        id, title, type, status, priority, project,
        complexity, complexity_manual, why, parent,
        created, updated, last_activity,
        claimed_by, claimed_at, claim_ttl_hours,
        branch, pr_number, pr_url, pr_state, pr_title, pr_merged_at, pr_base_branch,
        file_path, body, schema_version, spec_file
      ) VALUES (
        @id, @title, @type, @status, @priority, @project,
        @complexity, @complexity_manual, @why, @parent,
        @created, @updated, @last_activity,
        @claimed_by, @claimed_at, @claim_ttl_hours,
        @branch, @pr_number, @pr_url, @pr_state, @pr_title, @pr_merged_at, @pr_base_branch,
        @file_path, @body, @schema_version, @spec_file
      )
    `);

    const upsertAll = this.db.transaction((t: Task) => {
      insert.run({
        id: t.id,
        title: t.title,
        type: t.type,
        status: t.status,
        priority: t.priority,
        project: t.project,
        complexity: t.complexity ?? 0,
        complexity_manual: t.complexity_manual ? 1 : 0,
        why: t.why ?? null,
        parent: t.parent ?? null,
        created: t.created,
        updated: t.updated,
        last_activity: t.last_activity ?? null,
        claimed_by: t.claimed_by ?? null,
        claimed_at: t.claimed_at ?? null,
        claim_ttl_hours: t.claim_ttl_hours ?? null,
        branch: t.git.branch ?? null,
        pr_number: t.git.pr?.number ?? null,
        pr_url: t.git.pr?.url ?? null,
        pr_state: t.git.pr?.state ?? null,
        pr_title: t.git.pr?.title ?? null,
        pr_merged_at: t.git.pr?.merged_at ?? null,
        pr_base_branch: t.git.pr?.base_branch ?? null,
        file_path: t.file_path,
        body: t.body,
        schema_version: t.schema_version,
        spec_file: t.spec_file ?? null,
      });

      // Delete and re-insert related rows
      this.db.prepare('DELETE FROM subtasks WHERE parent_id=?').run(t.id);
      this.db.prepare('DELETE FROM dependencies WHERE task_id=?').run(t.id);
      this.db.prepare('DELETE FROM tags WHERE task_id=?').run(t.id);
      this.db.prepare('DELETE FROM transitions WHERE task_id=?').run(t.id);
      this.db.prepare('DELETE FROM commits WHERE task_id=?').run(t.id);
      this.db.prepare('DELETE FROM children WHERE parent_id=?').run(t.id);

      const insertSubtask = this.db.prepare(
        'INSERT INTO subtasks (id, parent_id, title, status, sort_order) VALUES (?, ?, ?, ?, ?)',
      );
      t.subtasks.forEach((s, i) => insertSubtask.run(s.id, t.id, s.title, s.status, i));

      const insertDep = this.db.prepare('INSERT OR IGNORE INTO dependencies (task_id, depends_on) VALUES (?, ?)');
      t.dependencies.forEach(dep => insertDep.run(t.id, dep));

      const insertTag = this.db.prepare('INSERT OR IGNORE INTO tags (task_id, tag) VALUES (?, ?)');
      t.tags.forEach(tag => insertTag.run(t.id, tag));

      const insertTransition = this.db.prepare(
        'INSERT INTO transitions (task_id, from_status, to_status, at, reason) VALUES (?, ?, ?, ?, ?)',
      );
      t.transitions.forEach(tr => insertTransition.run(t.id, tr.from, tr.to, tr.at, tr.reason ?? null));

      const insertCommit = this.db.prepare(
        'INSERT OR IGNORE INTO commits (sha, task_id, message, authored_at) VALUES (?, ?, ?, ?)',
      );
      t.git.commits.forEach(c => insertCommit.run(c.sha, t.id, c.message, c.authored_at));

      const insertChild = this.db.prepare('INSERT OR IGNORE INTO children (parent_id, child_id) VALUES (?, ?)');
      t.children.forEach(childId => insertChild.run(t.id, childId));
    });

    upsertAll(task);
  }

  deleteTask(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id=?').run(id);
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare<string>('SELECT * FROM tasks WHERE id=?').get(id) as TaskRow | undefined;
    if (!row) return null;
    return this.rowToTask(row);
  }

  listTasks(filters: { status?: TaskStatus; project?: string; priority?: Priority; limit?: number }): Task[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters.status) {
      conditions.push('status=?');
      params.push(filters.status);
    }
    if (filters.project) {
      conditions.push('project=?');
      params.push(filters.project);
    }
    if (filters.priority) {
      conditions.push('priority=?');
      params.push(filters.priority);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 50;

    const sql = `
      SELECT * FROM tasks ${where}
      ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
        created ASC
      LIMIT ?
    `;

    const rows = this.db.prepare(sql).all(...params, limit) as TaskRow[];
    return rows.map(r => this.rowToTask(r));
  }

  searchTasks(query: string): Task[] {
    const rows = this.db.prepare(`
      SELECT t.* FROM tasks t
      JOIN tasks_fts f ON t.rowid = f.rowid
      WHERE tasks_fts MATCH ?
      LIMIT 20
    `).all(query) as TaskRow[];
    return rows.map(r => this.rowToTask(r));
  }

  getNextTask(project: string): Task | null {
    const row = this.db.prepare(`
      SELECT t.* FROM tasks t
      WHERE t.project=?
        AND t.status='todo'
        AND t.id NOT IN (
          SELECT d.task_id FROM dependencies d
          JOIN tasks dep ON d.depends_on=dep.id
          WHERE dep.status != 'done'
        )
      ORDER BY
        CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
        t.created ASC
      LIMIT 1
    `).get(project) as TaskRow | undefined;

    if (!row) return null;
    return this.rowToTask(row);
  }

  getStats(project?: string): TaskStatsOutput {
    const where = project ? 'WHERE project=?' : '';
    const params = project ? [project] : [];

    const statusRows = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM tasks ${where} GROUP BY status
    `).all(...params) as StatsRow[];

    const by_status: Record<TaskStatus, number> = {
      todo: 0,
      in_progress: 0,
      done: 0,
      blocked: 0,
      archived: 0,
      draft: 0,
      approved: 0,
    };
    for (const r of statusRows) {
      by_status[r.status as TaskStatus] = r.count;
    }

    const total = Object.values(by_status).reduce((a, b) => a + b, 0);
    const completion_rate = total > 0 ? by_status.done / total : 0;

    // Avg cycle time by type (hours): time from first in_progress to done
    const cycleRows = this.db.prepare(`
      SELECT t.type,
        AVG(
          (julianday(tr_done.at) - julianday(tr_start.at)) * 24
        ) as avg_hours
      FROM tasks t
      JOIN transitions tr_start ON tr_start.task_id=t.id AND tr_start.to_status='in_progress'
      JOIN transitions tr_done ON tr_done.task_id=t.id AND tr_done.to_status='done'
      ${where ? where + ' AND' : 'WHERE'} t.status='done'
      GROUP BY t.type
    `).all(...params) as Array<{ type: string; avg_hours: number | null }>;

    const avg_cycle_time_by_type: Record<string, number | null> = {};
    for (const r of cycleRows) {
      avg_cycle_time_by_type[r.type] = r.avg_hours;
    }

    // Stale count: in_progress past TTL
    const staleWhere = project ? 'WHERE t.project=? AND' : 'WHERE';
    const staleRows = this.db.prepare(`
      SELECT COUNT(*) as count FROM tasks t
      ${staleWhere} t.status='in_progress'
        AND datetime(t.last_activity, '+' || t.claim_ttl_hours || ' hours') < datetime('now')
    `).get(...params) as { count: number };

    return {
      by_status,
      avg_cycle_time_by_type,
      completion_rate,
      stale_count: staleRows.count,
    };
  }

  claimTask(id: string, sessionId: string, ttlHours: number): boolean {
    const stmt = this.db.prepare(`
      UPDATE tasks
      SET claimed_by=@sessionId, claimed_at=datetime('now'), claim_ttl_hours=@ttlHours
      WHERE id=@id
        AND (claimed_by IS NULL
          OR datetime(claimed_at, '+' || claim_ttl_hours || ' hours') < datetime('now'))
    `);

    const result = stmt.run({ id, sessionId, ttlHours }) as ClaimChanges;
    return result.changes === 1;
  }

  releaseTask(id: string, sessionId: string): boolean {
    const result = this.db.prepare(`
      UPDATE tasks SET claimed_by=NULL, claimed_at=NULL
      WHERE id=? AND claimed_by=?
    `).run(id, sessionId) as ClaimChanges;
    return result.changes === 1;
  }

  getStaleTasks(project?: string): Task[] {
    const where = project
      ? "WHERE t.project=? AND t.status='in_progress' AND datetime(t.last_activity, '+' || t.claim_ttl_hours || ' hours') < datetime('now')"
      : "WHERE t.status='in_progress' AND datetime(t.last_activity, '+' || t.claim_ttl_hours || ' hours') < datetime('now')";
    const params = project ? [project] : [];

    const rows = this.db.prepare(`SELECT t.* FROM tasks t ${where}`).all(...params) as TaskRow[];
    return rows.map(r => this.rowToTask(r));
  }

  ensureProject(prefix: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO projects (prefix, path, storage_mode, tasks_dir, next_id, created)
      VALUES (?, '', 'local', '', 0, datetime('now'))
    `).run(prefix);
  }

  nextId(prefix: string): number {
    // Try to increment existing row
    const updateResult = this.db.prepare(`
      UPDATE projects SET next_id=next_id+1 WHERE prefix=? RETURNING next_id
    `).get(prefix) as { next_id: number } | undefined;

    if (updateResult) {
      return updateResult.next_id;
    }

    // No row — insert with next_id=1 and return 1
    try {
      this.db.prepare(`
        INSERT INTO projects (prefix, path, storage_mode, tasks_dir, next_id, created)
        VALUES (?, '', 'local', '', 1, datetime('now'))
      `).run(prefix);
    } catch {
      // Race condition — try update again
      const retryResult = this.db.prepare(`
        UPDATE projects SET next_id=next_id+1 WHERE prefix=? RETURNING next_id
      `).get(prefix) as { next_id: number } | undefined;
      if (retryResult) return retryResult.next_id;
      throw new McpTasksError('PROJECT_NOT_FOUND', `Cannot allocate ID for project: ${prefix}`);
    }

    return 1;
  }

  getChildTasks(parentId: string): Task[] {
    const rows = this.db.prepare(`
      SELECT t.* FROM tasks t
      JOIN children c ON c.child_id = t.id
      WHERE c.parent_id=?
    `).all(parentId) as TaskRow[];
    return rows.map(r => this.rowToTask(r));
  }

  close(): void {
    this.db.close();
  }
}
