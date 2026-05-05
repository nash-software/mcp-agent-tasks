import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { GlobalConfig } from '../types/config.js';

// McpTasksConfig is an alias for GlobalConfig
export type McpTasksConfig = GlobalConfig;

export const DEFAULT_TASKS_DIR_NAME = 'agent-tasks';

const DEFAULT_CONFIG: McpTasksConfig = {
  version: 1,
  storageDir: path.join(os.homedir(), '.mcp-tasks', 'tasks'),
  defaultStorage: 'global',
  enforcement: 'warn',
  autoCommit: false,
  claimTtlHours: 4,
  trackManifest: true,
  tasksDirName: DEFAULT_TASKS_DIR_NAME,
  projects: [],
};

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.config', 'mcp-tasks', 'config.json');

function validateConfig(raw: unknown): McpTasksConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Config must be a JSON object');
  }

  const obj = raw as Record<string, unknown>;

  const required = [
    'version',
    'storageDir',
    'defaultStorage',
    'enforcement',
    'autoCommit',
    'claimTtlHours',
    'trackManifest',
    'projects',
  ] as const;

  for (const key of required) {
    if (!(key in obj)) {
      throw new Error(`Config missing required field: ${key}`);
    }
  }

  // Backfill optional fields added after v1
  if (!('tasksDirName' in obj) || typeof obj['tasksDirName'] !== 'string') {
    obj['tasksDirName'] = DEFAULT_TASKS_DIR_NAME;
  }

  return obj as unknown as McpTasksConfig;
}

function readJsonFile(filePath: string): McpTasksConfig | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return validateConfig(parsed);
  } catch {
    return null;
  }
}

function ensureDefaultConfig(): McpTasksConfig {
  const dir = path.dirname(GLOBAL_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
  return DEFAULT_CONFIG;
}

export function loadConfig(): McpTasksConfig {
  // 1. Check env-specified config file
  const envConfigPath = process.env['MCP_TASKS_CONFIG'];
  if (envConfigPath) {
    const config = readJsonFile(envConfigPath);
    if (config) {
      return applyEnvOverrides(config);
    }
  }

  // 2. Local .mcp-tasks.json
  const localConfig = readJsonFile(path.join(process.cwd(), '.mcp-tasks.json'));
  if (localConfig) {
    return applyEnvOverrides(localConfig);
  }

  // 3. Global config file
  if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
    const globalConfig = readJsonFile(GLOBAL_CONFIG_PATH);
    if (globalConfig) {
      return applyEnvOverrides(globalConfig);
    }
  }

  // 4. First run — create default global config
  return applyEnvOverrides(ensureDefaultConfig());
}

function applyEnvOverrides(config: McpTasksConfig): McpTasksConfig {
  const result = { ...config };

  const tasksDir = process.env['MCP_TASKS_DIR'];
  if (tasksDir) {
    result.storageDir = tasksDir;
  }

  // MCP_TASKS_DB is a DB path hint — store as metadata but GlobalConfig has no dbPath field.
  // It is used directly by the SqliteIndex constructor caller; we expose it via a helper.

  return result;
}

export function getDbPath(): string {
  const envDb = process.env['MCP_TASKS_DB'];
  if (envDb) return envDb;

  const config = loadConfig();
  return path.join(config.storageDir, 'tasks.db');
}

export function resolveServerDbPath(tasksDir: string): string {
  return fs.existsSync(tasksDir) ? path.join(tasksDir, '.index.db') : getDbPath();
}
