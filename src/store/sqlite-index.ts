import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Task, TaskStatus, Priority, Area, AgentStatus, SubtaskEntry, StatusTransition, CommitRef, GitLink, TaskReference } from '../types/task.js';
import type { NoteRecord, NoteListInput } from '../types/note.js';
import { MAX_NOTE_LIST_LIMIT, DEFAULT_NOTE_LIST_LIMIT, MAX_NOTE_SEARCH_RESULTS } from '../types/note.js';
import type { TaskStatsOutput, MilestoneBurndown } from '../types/tools.js';
import { McpTasksError } from '../types/errors.js';
import { escapeRegExp } from '../util/escape-regexp.js';
import { MAX_TRANSITIONS, MAX_COMMITS, MAX_TAGS, MAX_FILES } from './limits.js';

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
  milestone: string | null;
  estimate_hours: number | null;
  plan_file: string | null;
  auto_captured: number;
  area: string | null;
  scheduled_for: string | null;
  agent_status: string | null;
  block_reason: string | null;
  triage_note: string | null;
  triage_confidence: number | null;
  closed_at: number | null;
  close_batch: string | null;
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

interface FilePathRow {
  task_id: string;
  path: string;
  sort_order: number;
}

interface StatsRow {
  status: string;
  count: number;
}

interface ClaimChanges {
  changes: number;
}

interface NoteRow {
  id: string;
  body: string;
  project: string;
  task_id: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
  brain_sync_failed: number;
  title: string | null;
  pinned: number;
}

export class SqliteIndex {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    // Apply connection-scoped pragmas unconditionally.
    // foreign_keys and journal_mode are NOT persisted across connections —
    // they must be set on every open. Setting them here (before init()/schema)
    // guarantees they are always active regardless of call order.
    try {
      // Enable incremental auto-vacuum BEFORE any table is created.
      // auto_vacuum only takes effect on a fresh/empty file (or after a full VACUUM),
      // so it must run before init() applies schema.sql. On an already-created /
      // bloated DB, this sets the mode for future pages but does NOT reclaim existing
      // free pages — the ratio-based self-heal in index-health.ts handles that path
      // by forcing a full rebuild+VACUUM of bloated existing files.
      this.db.pragma('auto_vacuum = INCREMENTAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('busy_timeout = 5000');
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('wal_autocheckpoint = 1000');
    } catch (err) {
      // A corrupt/non-database file throws on the first pragma. Release the
      // file handle before rethrowing so callers (e.g. index-health rebuild)
      // can delete the bad file — otherwise it stays locked on Windows.
      try { this.db.close(); } catch { /* ignore */ }
      throw err;
    }
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
    const addColumnIfNotExists = (sql: string): void => {
      try {
        this.db.exec(sql);
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes('duplicate column name')) {
          throw err;
        }
        // 'duplicate column name' means column already exists — expected on re-init
      }
    };

    addColumnIfNotExists('ALTER TABLE tasks ADD COLUMN body_hash TEXT');
    addColumnIfNotExists('ALTER TABLE tasks ADD COLUMN spec_file TEXT');
    addColumnIfNotExists('ALTER TABLE tasks ADD COLUMN milestone TEXT');
    addColumnIfNotExists('ALTER TABLE tasks ADD COLUMN estimate_hours REAL');
    addColumnIfNotExists('ALTER TABLE tasks ADD COLUMN plan_file TEXT');
    addColumnIfNotExists('ALTER TABLE tasks ADD COLUMN auto_captured INTEGER DEFAULT 0');
    addColumnIfNotExists("ALTER TABLE tasks ADD COLUMN area TEXT CHECK(area IN ('client','personal','outsource','internal') OR area IS NULL)");
    addColumnIfNotExists('ALTER TABLE tasks ADD COLUMN scheduled_for TEXT');
    addColumnIfNotExists("ALTER TABLE tasks ADD COLUMN agent_status TEXT CHECK(agent_status IN ('scheduled','running','done') OR agent_status IS NULL)");
    addColumnIfNotExists('ALTER TABLE tasks ADD COLUMN block_reason TEXT');
    addColumnIfNotExists('ALTER TABLE tasks ADD COLUMN triage_note TEXT');
    addColumnIfNotExists('ALTER TABLE tasks ADD COLUMN triage_confidence REAL');
    addColumnIfNotExists('ALTER TABLE tasks ADD COLUMN closed_at INTEGER');
    addColumnIfNotExists('ALTER TABLE tasks ADD COLUMN close_batch TEXT');

    // Ensure new tables exist on pre-existing DBs (idempotent — IF NOT EXISTS)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS milestones (
        id TEXT NOT NULL,
        project TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        due_date TEXT,
        status TEXT DEFAULT 'open' CHECK(status IN ('open','closed')),
        created TEXT NOT NULL,
        PRIMARY KEY (id, project)
      );
      CREATE TABLE IF NOT EXISTS task_references (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        ref_type TEXT NOT NULL CHECK(ref_type IN ('closes','blocks','related')),
        PRIMARY KEY (from_id, to_id, ref_type),
        FOREIGN KEY (from_id) REFERENCES tasks(id) ON DELETE CASCADE,
        CHECK (from_id != to_id)
      );
      CREATE TABLE IF NOT EXISTS task_files (
        task_id TEXT NOT NULL,
        path TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (task_id, path),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone);
      CREATE INDEX IF NOT EXISTS idx_task_refs_from ON task_references(from_id);
      CREATE INDEX IF NOT EXISTS idx_task_refs_to ON task_references(to_id);
      CREATE INDEX IF NOT EXISTS idx_task_files_task ON task_files(task_id);
    `);

    this.initNotesTable();
  }

  private initNotesTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        project TEXT NOT NULL,
        task_id TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        brain_sync_failed INTEGER NOT NULL DEFAULT 0,
        title TEXT,
        pinned INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project);
      CREATE INDEX IF NOT EXISTS idx_notes_task_id ON notes(task_id);
      CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at);
    `);
    // Migration for existing DBs that have the notes table but lack brain_sync_failed
    try {
      this.db.exec('ALTER TABLE notes ADD COLUMN brain_sync_failed INTEGER NOT NULL DEFAULT 0');
    } catch {
      // Column already exists — expected on re-init
    }
    // Migration: add title and pinned columns (Phase E)
    const noteColumns = this.db.pragma('table_info(notes)') as Array<{ name: string }>;
    const noteColNames = new Set(noteColumns.map(c => c.name));
    if (!noteColNames.has('title')) {
      this.db.exec('ALTER TABLE notes ADD COLUMN title TEXT');
    }
    if (!noteColNames.has('pinned')) {
      this.db.exec('ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
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

    const files = (
      this.db.prepare<string>('SELECT path FROM task_files WHERE task_id=? ORDER BY sort_order').all(row.id) as FilePathRow[]
    ).map(f => f.path);

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

    const task: Task = {
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
      files,
      body: row.body ?? '',
      file_path: row.file_path,
      ...(row.spec_file !== null ? { spec_file: row.spec_file } : {}),
      ...(row.milestone !== null ? { milestone: row.milestone } : {}),
      ...(row.estimate_hours !== null ? { estimate_hours: row.estimate_hours } : {}),
      ...(row.plan_file !== null ? { plan_file: row.plan_file } : {}),
      ...(row.auto_captured === 1 ? { auto_captured: true } : {}),
      ...(row.area !== null ? { area: row.area as Area } : {}),
      ...(row.scheduled_for !== null ? { scheduled_for: row.scheduled_for } : {}),
      ...(row.agent_status !== null ? { agent_status: row.agent_status as AgentStatus } : {}),
      ...(row.block_reason !== null ? { block_reason: row.block_reason } : {}),
      ...(row.triage_note !== null ? { triage_note: row.triage_note } : {}),
      ...(row.triage_confidence !== null ? { triage_confidence: row.triage_confidence } : {}),
      ...(row.closed_at !== null ? { closed_at: row.closed_at } : {}),
      ...(row.close_batch !== null ? { close_batch: row.close_batch } : {}),
    };

    // Attach references if any exist
    const refRows = this.db.prepare<string>(
      'SELECT ref_type, to_id FROM task_references WHERE from_id=?',
    ).all(row.id) as Array<{ ref_type: string; to_id: string }>;
    if (refRows.length > 0) {
      task.references = refRows.map(r => ({
        type: r.ref_type as TaskReference['type'],
        id: r.to_id,
      }));
    }

    return task;
  }

  /**
   * Compute a stable SHA-1 hash of a task's markdown body.
   * Used by the incremental reconciler to skip upserts when the body has not changed.
   */
  static hashBody(body: string): string {
    return crypto.createHash('sha1').update(body).digest('hex');
  }

  /**
   * Return the stored body_hash for the task with the given id, or null if
   * the task is not in the index or has no hash recorded.
   */
  getBodyHash(id: string): string | null {
    const row = this.db
      .prepare<string>('SELECT body_hash FROM tasks WHERE id=?')
      .get(id) as { body_hash: string | null } | undefined;
    return row?.body_hash ?? null;
  }

  /**
   * Upsert a task. `bodyHash` is the single canonical change-detection hash —
   * the reconciler passes the hash of the FULL markdown file (frontmatter +
   * body). Callers without a file (MCP tool writes) omit it; body_hash is then
   * null and the next reconcile re-syncs it once (MCPAT-049 F4 — one hash owner,
   * no post-upsert patching).
   */
  upsertTask(task: Task, bodyHash?: string | null): void {
    // Use ON CONFLICT(id) DO UPDATE instead of INSERT OR REPLACE.
    // INSERT OR REPLACE fires tasks_ad (AFTER DELETE) + tasks_ai (AFTER INSERT) for every
    // existing row, causing FTS shadow page churn on every reconcile.
    // ON CONFLICT routes existing rows through tasks_au (AFTER UPDATE) which does a clean
    // delete+reinsert in the FTS index without disturbing the rowid, avoiding free-page bloat.
    // Every non-PK column must appear in the SET list — a missing column silently stops updating.
    const insert = this.db.prepare(`
      INSERT INTO tasks (
        id, title, type, status, priority, project,
        complexity, complexity_manual, why, parent,
        created, updated, last_activity,
        claimed_by, claimed_at, claim_ttl_hours,
        branch, pr_number, pr_url, pr_state, pr_title, pr_merged_at, pr_base_branch,
        file_path, body, body_hash, schema_version, spec_file,
        milestone, estimate_hours, plan_file, auto_captured,
        area, scheduled_for, agent_status, block_reason,
        triage_note, triage_confidence, closed_at, close_batch
      ) VALUES (
        @id, @title, @type, @status, @priority, @project,
        @complexity, @complexity_manual, @why, @parent,
        @created, @updated, @last_activity,
        @claimed_by, @claimed_at, @claim_ttl_hours,
        @branch, @pr_number, @pr_url, @pr_state, @pr_title, @pr_merged_at, @pr_base_branch,
        @file_path, @body, @body_hash, @schema_version, @spec_file,
        @milestone, @estimate_hours, @plan_file, @auto_captured,
        @area, @scheduled_for, @agent_status, @block_reason,
        @triage_note, @triage_confidence, @closed_at, @close_batch
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        type = excluded.type,
        status = excluded.status,
        priority = excluded.priority,
        project = excluded.project,
        complexity = excluded.complexity,
        complexity_manual = excluded.complexity_manual,
        why = excluded.why,
        parent = excluded.parent,
        created = excluded.created,
        updated = excluded.updated,
        last_activity = excluded.last_activity,
        claimed_by = excluded.claimed_by,
        claimed_at = excluded.claimed_at,
        claim_ttl_hours = excluded.claim_ttl_hours,
        branch = excluded.branch,
        pr_number = excluded.pr_number,
        pr_url = excluded.pr_url,
        pr_state = excluded.pr_state,
        pr_title = excluded.pr_title,
        pr_merged_at = excluded.pr_merged_at,
        pr_base_branch = excluded.pr_base_branch,
        file_path = excluded.file_path,
        body = excluded.body,
        body_hash = excluded.body_hash,
        schema_version = excluded.schema_version,
        spec_file = excluded.spec_file,
        milestone = excluded.milestone,
        estimate_hours = excluded.estimate_hours,
        plan_file = excluded.plan_file,
        auto_captured = excluded.auto_captured,
        area = excluded.area,
        scheduled_for = excluded.scheduled_for,
        agent_status = excluded.agent_status,
        block_reason = excluded.block_reason,
        triage_note = excluded.triage_note,
        triage_confidence = excluded.triage_confidence,
        closed_at = excluded.closed_at,
        close_batch = excluded.close_batch
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
        body_hash: bodyHash ?? null,
        schema_version: t.schema_version,
        spec_file: t.spec_file ?? null,
        milestone: t.milestone ?? null,
        estimate_hours: t.estimate_hours ?? null,
        plan_file: t.plan_file ?? null,
        auto_captured: t.auto_captured ? 1 : 0,
        area: t.area ?? null,
        scheduled_for: t.scheduled_for ?? null,
        agent_status: t.agent_status ?? null,
        block_reason: t.block_reason ?? null,
        triage_note: t.triage_note ?? null,
        triage_confidence: t.triage_confidence ?? null,
        closed_at: t.closed_at ?? null,
        close_batch: t.close_batch ?? null,
      });

      // Delete and re-insert related rows
      this.db.prepare('DELETE FROM subtasks WHERE parent_id=?').run(t.id);
      this.db.prepare('DELETE FROM dependencies WHERE task_id=?').run(t.id);
      this.db.prepare('DELETE FROM tags WHERE task_id=?').run(t.id);
      this.db.prepare('DELETE FROM transitions WHERE task_id=?').run(t.id);
      this.db.prepare('DELETE FROM commits WHERE task_id=?').run(t.id);
      this.db.prepare('DELETE FROM children WHERE parent_id=?').run(t.id);
      this.db.prepare('DELETE FROM task_references WHERE from_id=?').run(t.id);
      this.db.prepare('DELETE FROM task_files WHERE task_id=?').run(t.id);

      const insertSubtask = this.db.prepare(
        'INSERT INTO subtasks (id, parent_id, title, status, sort_order) VALUES (?, ?, ?, ?, ?)',
      );
      t.subtasks.forEach((s, i) => insertSubtask.run(s.id, t.id, s.title, s.status, i));

      const insertDep = this.db.prepare('INSERT OR IGNORE INTO dependencies (task_id, depends_on) VALUES (?, ?)');
      t.dependencies.forEach(dep => insertDep.run(t.id, dep));

      // Cap + dedup tags before inserting — never store more than MAX_TAGS
      const uniqueTags = [...new Set(t.tags)].slice(0, MAX_TAGS);
      const insertTag = this.db.prepare('INSERT OR IGNORE INTO tags (task_id, tag) VALUES (?, ?)');
      uniqueTags.forEach(tag => insertTag.run(t.id, tag));

      // Cap transitions to last MAX_TRANSITIONS — prevents unbounded child-row growth
      const insertTransition = this.db.prepare(
        'INSERT INTO transitions (task_id, from_status, to_status, at, reason) VALUES (?, ?, ?, ?, ?)',
      );
      t.transitions.slice(-MAX_TRANSITIONS).forEach(tr => insertTransition.run(t.id, tr.from, tr.to, tr.at, tr.reason ?? null));

      // Cap commits to last MAX_COMMITS — prevents unbounded child-row growth
      const insertCommit = this.db.prepare(
        'INSERT OR IGNORE INTO commits (sha, task_id, message, authored_at) VALUES (?, ?, ?, ?)',
      );
      t.git.commits.slice(-MAX_COMMITS).forEach(c => insertCommit.run(c.sha, t.id, c.message, c.authored_at));

      const insertChild = this.db.prepare('INSERT OR IGNORE INTO children (parent_id, child_id) VALUES (?, ?)');
      t.children.forEach(childId => insertChild.run(t.id, childId));

      const insertRef = this.db.prepare(
        'INSERT OR IGNORE INTO task_references (from_id, to_id, ref_type) VALUES (?, ?, ?)',
      );
      (t.references ?? []).forEach(r => insertRef.run(t.id, r.id, r.type));

      // Cap files to the first MAX_FILES — mirrors child-array cap philosophy (handbook critical-rules)
      const insertFile = this.db.prepare(
        'INSERT OR IGNORE INTO task_files (task_id, path, sort_order) VALUES (?, ?, ?)',
      );
      (t.files ?? []).slice(0, MAX_FILES).forEach((fp, i) => insertFile.run(t.id, fp, i));
    });

    upsertAll(task);
  }

  /** Package-internal: exposes the raw better-sqlite3 Database for use by
   * MilestoneRepository and ReferenceRepository. Do not use outside store/. */
  getRawDb(): Database.Database {
    return this.db;
  }

  deleteTask(id: string): void {
    // Belt-and-suspenders explicit cascade: delete all child rows BEFORE the
    // task row, in addition to the FK CASCADE triggers already in schema.sql.
    // This ensures no orphan rows survive even if FK enforcement was temporarily off.
    const deleteCascade = this.db.transaction((taskId: string) => {
      this.db.prepare('DELETE FROM subtasks WHERE parent_id=?').run(taskId);
      this.db.prepare('DELETE FROM dependencies WHERE task_id=?').run(taskId);
      this.db.prepare('DELETE FROM tags WHERE task_id=?').run(taskId);
      this.db.prepare('DELETE FROM transitions WHERE task_id=?').run(taskId);
      this.db.prepare('DELETE FROM commits WHERE task_id=?').run(taskId);
      // Both directions: the task may appear as parent OR child / from OR to.
      this.db.prepare('DELETE FROM children WHERE parent_id=? OR child_id=?').run(taskId, taskId);
      this.db.prepare('DELETE FROM task_references WHERE from_id=? OR to_id=?').run(taskId, taskId);
      this.db.prepare('DELETE FROM task_files WHERE task_id=?').run(taskId);
      this.db.prepare('DELETE FROM tasks WHERE id=?').run(taskId);
    });
    deleteCascade(id);
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare<string>('SELECT * FROM tasks WHERE id=?').get(id) as TaskRow | undefined;
    if (!row) return null;
    return this.rowToTask(row);
  }

  listTasks(filters: { status?: TaskStatus; project?: string; priority?: Priority; limit?: number; auto_captured?: boolean }): Task[] {
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
    if (filters.auto_captured !== undefined) {
      conditions.push('auto_captured=?');
      params.push(filters.auto_captured ? 1 : 0);
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
      closed: 0,
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

    // Milestone burndown
    const milestoneRows = this.db.prepare(`
      SELECT m.id, m.title, m.status, m.due_date,
        COUNT(t.id) as total,
        SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) as done
      FROM milestones m
      LEFT JOIN tasks t ON t.milestone=m.id ${project ? 'AND t.project=?' : ''}
      ${project ? 'WHERE m.project=?' : ''}
      GROUP BY m.id, m.project
    `).all(...(project ? [project, project] : [])) as Array<{
      id: string; title: string; status: string; due_date: string | null;
      total: number; done: number;
    }>;

    const milestones: MilestoneBurndown[] = milestoneRows.map(r => ({
      id: r.id,
      title: r.title,
      status: r.status as 'open' | 'closed',
      total: r.total,
      done: r.done ?? 0,
      ...(r.due_date ? { due_date: r.due_date } : {}),
    }));

    // Orphaned milestones: tasks reference a milestone not in milestones table
    const orphanRows = this.db.prepare(`
      SELECT DISTINCT t.milestone FROM tasks t
      WHERE t.milestone IS NOT NULL
        AND t.milestone NOT IN (SELECT id FROM milestones)
        ${project ? 'AND t.project=?' : ''}
    `).all(...(project ? [project] : [])) as Array<{ milestone: string }>;
    const orphaned_milestones = orphanRows.map(r => r.milestone);

    return {
      by_status,
      avg_cycle_time_by_type,
      completion_rate,
      stale_count: staleRows.count,
      ...(milestones.length > 0 ? { milestones } : {}),
      ...(orphaned_milestones.length > 0 ? { orphaned_milestones } : {}),
    };
  }

  // MCPAT-066: optional `project` filter. The dashboard opens several global-storage projects that SHARE
  // one underlying index db; without scoping, aggregating these unscoped queries across each projectIndex
  // returns the shared db's rows once per global project (duplicate task ids in /api/today).
  getTasksByScheduledDate(date: string, project?: string): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks
      WHERE scheduled_for = @date
        AND (@project IS NULL OR project = @project)
      ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
        title ASC
    `).all({ date, project: project ?? null }) as TaskRow[];
    return rows.map(r => this.rowToTask(r));
  }

  getCandidates(limit: number, project?: string): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks
      WHERE (status = 'todo' OR status = 'in_progress')
        AND scheduled_for IS NULL
        AND (@project IS NULL OR project = @project)
      ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
        title ASC
      LIMIT @limit
    `).all({ limit, project: project ?? null }) as TaskRow[];
    return rows.map(r => this.rowToTask(r));
  }

  /** Returns draft tasks that have a triage_note (the "Needs your call" queue). */
  getDraftTasksWithTriageNote(limit: number = 50): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks
      WHERE status = 'draft'
        AND triage_note IS NOT NULL
      ORDER BY last_activity DESC
      LIMIT ?
    `).all(limit) as TaskRow[];
    return rows.map(r => this.rowToTask(r));
  }

  getRecentActivity(limit: number = 50, project?: string): Array<{ task_id: string; title: string; from_status: string; to_status: string; at: string; reason: string | null }> {
    // MCPAT-066: optional project scope — global-storage projects share one index db, so an unscoped
    // aggregation across projectIndexes would repeat the shared db's rows once per global project.
    return this.db.prepare(`
      SELECT tr.task_id, t.title, tr.from_status, tr.to_status, tr.at, tr.reason
      FROM transitions tr
      JOIN tasks t ON t.id = tr.task_id
      WHERE (@project IS NULL OR t.project = @project)
      ORDER BY tr.at DESC
      LIMIT @limit
    `).all({ limit, project: project ?? null }) as Array<{ task_id: string; title: string; from_status: string; to_status: string; at: string; reason: string | null }>;
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

  /**
   * Highest numeric suffix among task IDs already indexed for a project (e.g. `COND-011` → 11).
   * Returns 0 when the project has no tasks. Used to make nextId authoritative (MCPAT-060).
   */
  maxIdNumberForProject(prefix: string): number {
    const rows = this.db.prepare(`SELECT id FROM tasks WHERE project = ?`).all(prefix) as { id: string }[];
    const re = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
    let max = 0;
    for (const r of rows) {
      const m = re.exec(r.id);
      if (m && m[1]) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max;
  }

  nextId(prefix: string, tasksDir?: string): number {
    if (tasksDir && fs.existsSync(tasksDir)) {
      const re = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)`);
      let onDiskMax = 0;
      for (const entry of fs.readdirSync(tasksDir)) {
        const m = re.exec(entry);
        if (m && m[1]) {
          const n = parseInt(m[1], 10);
          if (n > onDiskMax) onDiskMax = n;
        }
      }
      if (onDiskMax > 0) {
        this.db.prepare(`
          INSERT INTO projects (prefix, path, storage_mode, tasks_dir, next_id, created)
          VALUES (?, '', 'local', '', ?, datetime('now'))
          ON CONFLICT(prefix) DO UPDATE SET next_id = MAX(next_id, excluded.next_id)
        `).run(prefix, onDiskMax);
      }
    }

    // Authoritative watermark: also reconcile against the max ID already present in the index for
    // this project. This makes nextId safe even when `tasksDir` is not passed or the stored watermark
    // is stale (e.g. after an index rebuild) — without it, a low stale counter hands out an ID that
    // already exists on disk, producing (id, project) collisions (MCPAT-060).
    const indexMax = this.maxIdNumberForProject(prefix);
    if (indexMax > 0) {
      this.db.prepare(`
        INSERT INTO projects (prefix, path, storage_mode, tasks_dir, next_id, created)
        VALUES (?, '', 'local', '', ?, datetime('now'))
        ON CONFLICT(prefix) DO UPDATE SET next_id = MAX(next_id, excluded.next_id)
      `).run(prefix, indexMax);
    }

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

  /**
   * Flush and truncate the WAL file back to zero bytes.
   * Called automatically by close() and can be called by callers that want
   * to compact the WAL without closing the connection.
   * Never throws — failures are logged to stderr.
   */
  checkpoint(): void {
    if (!this.db.open) return; // no-op if the connection is already closed
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sqlite-index] checkpoint failed: ${msg}`);
    }
  }

  /**
   * Rebuild the FTS5 shadow tables from scratch.
   * Call after a full reconcile to prevent orphaned shadow rows from leaking
   * across reconcile runs and inflating the database file.
   * Never throws — failures are logged to stderr.
   */
  rebuildFts(): void {
    if (!this.db.open) return;
    try {
      this.db.exec("INSERT INTO tasks_fts(tasks_fts) VALUES('rebuild')");
      this.db.exec("INSERT INTO tasks_fts(tasks_fts) VALUES('optimize')");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sqlite-index] rebuildFts failed: ${msg}`);
    }
  }

  /**
   * Return the ratio of free (unused) pages to total pages in the DB file.
   * Returns 0 when page_count is 0 or when the DB is not open.
   * Never throws — returns 0 on any error.
   *
   * Used by ensureHealthyIndex for ratio-based bloat detection (MCPAT-071 Step B).
   */
  freePageRatio(): number {
    if (!this.db.open) return 0;
    try {
      const freelist = this.db.pragma('freelist_count', { simple: true }) as number;
      const pageCount = this.db.pragma('page_count', { simple: true }) as number;
      if (pageCount === 0) return 0;
      return freelist / pageCount;
    } catch {
      return 0;
    }
  }

  /**
   * Return the total number of pages in the DB file.
   * Returns 0 when the DB is not open or on error.
   * Used alongside freePageRatio() for the bloat floor check.
   */
  pageCount(): number {
    if (!this.db.open) return 0;
    try {
      return this.db.pragma('page_count', { simple: true }) as number;
    } catch {
      return 0;
    }
  }

  /**
   * Run SQLite's built-in quick_check integrity verification.
   * Returns true if the database passes ('ok'), false if corrupt.
   * Never throws — failures are treated as corrupt.
   */
  quickCheck(): boolean {
    if (!this.db.open) return false;
    try {
      const result = this.db.pragma('quick_check', { simple: true }) as string;
      return result === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Run VACUUM to reclaim free pages and compact the database file.
   * Called after a forced rebuild to start with a minimal file size.
   * Never throws — failures are logged to stderr.
   */
  vacuum(): void {
    if (!this.db.open) return;
    try {
      this.db.exec('VACUUM');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sqlite-index] vacuum failed: ${msg}`);
    }
  }

  /**
   * Reclaim free pages incrementally without a full file rewrite.
   * Requires auto_vacuum = INCREMENTAL (set in constructor).
   * Call after checkpoint() so the WAL is flushed first — free pages in the WAL
   * cannot be reclaimed until they are in the main file.
   *
   * @param pages Number of free pages to reclaim. Omit to reclaim all free pages.
   * Never throws — failures are logged to stderr.
   */
  incrementalVacuum(pages?: number): void {
    if (!this.db.open) return;
    try {
      if (pages !== undefined) {
        this.db.pragma(`incremental_vacuum(${pages})`);
      } else {
        this.db.pragma('incremental_vacuum');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sqlite-index] incrementalVacuum failed: ${msg}`);
    }
  }

  // ── Notes ────────────────────────────────────────────────────────────────

  /** Next numeric suffix for a note ID in the given project (e.g. MCPAT-N-3 → 3). */
  nextNoteId(project: string): number {
    const rows = this.db.prepare(`SELECT id FROM notes WHERE project = ?`).all(project) as { id: string }[];
    const re = new RegExp(`^${escapeRegExp(project)}-N-(\\d+)$`);
    let max = 0;
    for (const r of rows) {
      const m = re.exec(r.id);
      if (m && m[1]) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  }

  upsertNote(note: NoteRecord): void {
    this.db.prepare(`
      INSERT INTO notes (id, body, project, task_id, tags, created_at, updated_at, title, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        body = excluded.body,
        task_id = excluded.task_id,
        tags = excluded.tags,
        updated_at = excluded.updated_at,
        title = excluded.title,
        pinned = excluded.pinned
    `).run(
      note.id,
      note.body,
      note.project,
      note.task_id,
      JSON.stringify(note.tags),
      note.created_at,
      note.updated_at,
      note.title ?? null,
      note.pinned ? 1 : 0,
    );
  }

  deleteNote(id: string): void {
    this.db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);
  }

  getNote(id: string): NoteRecord | null {
    const row = this.db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as NoteRow | undefined;
    if (!row) return null;
    return this.rowToNote(row);
  }

  listNotes(opts: NoteListInput = {}): NoteRecord[] {
    const limit = Math.min(opts.limit ?? DEFAULT_NOTE_LIST_LIMIT, MAX_NOTE_LIST_LIMIT);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.project) {
      conditions.push('project = ?');
      params.push(opts.project);
    }
    if (opts.task_id) {
      conditions.push('task_id = ?');
      params.push(opts.task_id);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM notes ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit) as NoteRow[];

    return rows.map(r => this.rowToNote(r));
  }

  searchNotes(q: string, project?: string): NoteRecord[] {
    const like = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    let rows: NoteRow[];
    if (project) {
      rows = this.db.prepare(
        `SELECT * FROM notes WHERE project = ? AND body LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`,
      ).all(project, like, MAX_NOTE_SEARCH_RESULTS) as NoteRow[];
    } else {
      rows = this.db.prepare(
        `SELECT * FROM notes WHERE body LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`,
      ).all(like, MAX_NOTE_SEARCH_RESULTS) as NoteRow[];
    }
    return rows.map(r => this.rowToNote(r));
  }

  linkNoteToTask(noteId: string, taskId: string, updatedAt: string): void {
    const result = this.db.prepare(
      `UPDATE notes SET task_id = ?, updated_at = ? WHERE id = ?`,
    ).run(taskId, updatedAt, noteId) as { changes: number };
    if (result.changes === 0) {
      throw new McpTasksError('NOTE_NOT_FOUND', `Note not found: ${noteId}`);
    }
  }

  private rowToNote(row: NoteRow): NoteRecord {
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(row.tags) as unknown;
      if (Array.isArray(parsed)) {
        tags = parsed.filter((t): t is string => typeof t === 'string');
      }
    } catch {
      tags = [];
    }
    return {
      id: row.id,
      body: row.body,
      project: row.project,
      task_id: row.task_id,
      tags,
      created_at: row.created_at,
      updated_at: row.updated_at,
      ...(row.brain_sync_failed ? { brain_sync_failed: true } : {}),
      ...(row.title != null ? { title: row.title } : {}),
      ...(row.pinned ? { pinned: true } : {}),
    };
  }

  markNoteBrainSyncFailed(id: string): void {
    this.db.prepare(`UPDATE notes SET brain_sync_failed = 1 WHERE id = ?`).run(id);
  }

  clearNoteBrainSyncFailed(id: string): void {
    this.db.prepare(`UPDATE notes SET brain_sync_failed = 0 WHERE id = ?`).run(id);
  }

  getNotesPendingBrainSync(): NoteRecord[] {
    const rows = this.db.prepare(`SELECT * FROM notes WHERE brain_sync_failed = 1`).all() as NoteRow[];
    return rows.map(r => this.rowToNote(r));
  }

  close(): void {
    if (!this.db.open) return; // idempotent: safe to call multiple times
    // Checkpoint WAL before closing so the WAL file is not left behind.
    this.checkpoint();
    this.db.close();
  }
}
