PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_meta VALUES ('schema_version', '1');

CREATE TABLE IF NOT EXISTS projects (
  prefix TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  storage_mode TEXT NOT NULL CHECK(storage_mode IN ('global','local')),
  tasks_dir TEXT NOT NULL,
  next_id INTEGER NOT NULL DEFAULT 1,
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('feature','bug','chore','spike','refactor','spec')),
  status TEXT NOT NULL CHECK(status IN ('todo','in_progress','done','blocked','archived','draft','approved')),
  priority TEXT NOT NULL CHECK(priority IN ('critical','high','medium','low')),
  project TEXT NOT NULL REFERENCES projects(prefix),
  complexity INTEGER CHECK(complexity BETWEEN 1 AND 10),
  complexity_manual INTEGER NOT NULL DEFAULT 0,
  why TEXT,
  parent TEXT REFERENCES tasks(id),
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  last_activity TEXT NOT NULL,
  claimed_by TEXT,
  claimed_at TEXT,
  claim_ttl_hours INTEGER DEFAULT 4,
  branch TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  pr_state TEXT CHECK(pr_state IN ('open','merged','closed') OR pr_state IS NULL),
  pr_title TEXT,
  pr_merged_at TEXT,
  pr_base_branch TEXT,
  file_path TEXT NOT NULL,
  body TEXT,
  body_hash TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  spec_file TEXT
);

CREATE TABLE IF NOT EXISTS subtasks (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('todo','in_progress','done','blocked')),
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on TEXT NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on),
  CHECK (task_id != depends_on)
);

CREATE TABLE IF NOT EXISTS tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (task_id, tag)
);

CREATE TABLE IF NOT EXISTS transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  at TEXT NOT NULL,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS commits (
  sha TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  authored_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS children (
  parent_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_id, child_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
  id UNINDEXED,
  title,
  why,
  body,
  content='tasks',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, id, title, why, body)
  VALUES (new.rowid, new.id, new.title, new.why, new.body);
END;

CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, id, title, why, body)
  VALUES ('delete', old.rowid, old.id, old.title, old.why, old.body);
END;

CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, id, title, why, body)
  VALUES ('delete', old.rowid, old.id, old.title, old.why, old.body);
  INSERT INTO tasks_fts(rowid, id, title, why, body)
  VALUES (new.rowid, new.id, new.title, new.why, new.body);
END;

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent);
CREATE INDEX IF NOT EXISTS idx_tasks_last_activity ON tasks(last_activity);
CREATE INDEX IF NOT EXISTS idx_tasks_claimed_by ON tasks(claimed_by);
