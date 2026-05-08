#!/usr/bin/env node
// Builds .summary.jsonl per project — one JSON line per task.
// Run: node scripts/build-task-summary.js

import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

const DEFAULT_TASKS_DIR_NAME = 'agent-tasks';
const GLOBAL_CONFIG_PATH = join(homedir(), '.config', 'mcp-tasks', 'config.json');

function loadConfig() {
  const configPath = process.env['MCP_TASKS_CONFIG'] ?? GLOBAL_CONFIG_PATH;
  if (!existsSync(configPath)) return { projects: [], tasksDirName: DEFAULT_TASKS_DIR_NAME };
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to parse config at ${configPath}: ${err.message}`);
    process.exit(1);
  }
}

const config = loadConfig();
const tasksDirName = config.tasksDirName ?? DEFAULT_TASKS_DIR_NAME;

if (!config.projects || config.projects.length === 0) {
  console.log('No projects configured.');
  process.exit(0);
}

for (const p of config.projects) {
  const tasksDir = join(p.path, tasksDirName);
  const dbPath = join(tasksDir, '.index.db');
  if (!existsSync(dbPath)) {
    console.log(`${p.prefix}: no DB at ${dbPath}, skipping`);
    continue;
  }

  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(
    `SELECT id, title, status, type, priority, project, milestone, claimed_by, last_activity, branch
     FROM tasks WHERE project = ? ORDER BY last_activity DESC LIMIT 10000`
  ).all(p.prefix);
  db.close();

  const lines = rows.map(r => JSON.stringify({
    id: r.id,
    title: r.title,
    status: r.status,
    type: r.type,
    priority: r.priority,
    project: r.project,
    milestone: r.milestone ?? null,
    claimed_by: r.claimed_by ?? null,
    branch: r.branch ?? null,
    last_activity: r.last_activity,
  }));

  const outPath = join(tasksDir, '.summary.jsonl');
  writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');
  console.log(`${p.prefix}: wrote ${lines.length} tasks to ${outPath}`);
}
