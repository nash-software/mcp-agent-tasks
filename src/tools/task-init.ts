import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpTasksError } from '../types/errors.js';
import { SqliteIndex } from '../store/sqlite-index.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_init';

export const description =
  'Initialize a new project tasks directory. Creates tasks/, archive/, .gitignore, and SQLite index. Idempotent.';

export const schema = {
  type: 'object',
  properties: {
    project_prefix: { type: 'string', description: 'Project prefix (e.g. HERALD)' },
    project_path: {
      type: 'string',
      description: 'Absolute path to the project root (defaults to cwd)',
    },
    storage_mode: {
      type: 'string',
      enum: ['global', 'local'],
      description: 'Storage mode (default: global)',
    },
  },
  required: ['project_prefix'],
} as const;

interface ValidatedInput {
  project_prefix: string;
  project_path?: string;
  storage_mode?: 'global' | 'local';
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw['project_prefix'] !== 'string' || !raw['project_prefix']) {
    throw new McpTasksError('INVALID_FIELD', 'project_prefix is required and must be a string');
  }
  if (
    raw['storage_mode'] !== undefined &&
    raw['storage_mode'] !== 'global' &&
    raw['storage_mode'] !== 'local'
  ) {
    throw new McpTasksError('INVALID_FIELD', "storage_mode must be 'global' or 'local'");
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const storageMode = input.storage_mode ?? 'global';
  const projectPath = input.project_path ?? process.cwd();

  let tasksDir: string;
  let dbPath: string;

  const dirName = ctx.config.tasksDirName;
  if (storageMode === 'local') {
    tasksDir = path.join(projectPath, dirName);
    dbPath = path.join(projectPath, dirName, '.index.db');
  } else {
    tasksDir = path.join(ctx.config.storageDir, input.project_prefix.toLowerCase());
    dbPath = path.join(ctx.config.storageDir, '.index.db');
  }

  // Create directories (idempotent)
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(tasksDir, 'archive'), { recursive: true });

  // Create .gitignore if it doesn't exist
  const gitignorePath = path.join(tasksDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '.index.db\n*.db-wal\n*.db-shm\n', 'utf-8');
  }

  // Initialize SQLite index
  const dbDir = path.dirname(dbPath);
  fs.mkdirSync(dbDir, { recursive: true });
  const index = new SqliteIndex(dbPath);
  index.init();
  index.close();

  // Register in config if not already present
  const existing = ctx.config.projects.find(p => p.prefix === input.project_prefix);
  if (!existing) {
    ctx.config.projects.push({
      prefix: input.project_prefix,
      path: projectPath,
      storage: storageMode,
    });

    // Persist config
    const configPath =
      process.env['MCP_TASKS_CONFIG'] ??
      path.join(os.homedir(), '.config', 'mcp-tasks', 'config.json');
    const configDir = path.dirname(configPath);
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(ctx.config, null, 2), 'utf-8');
  }

  return ok({ initialized: true, path: tasksDir });
}
