import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_register_project';

export const description =
  'Register an existing project with mcp-agent-tasks without re-initializing.';

export const schema = {
  type: 'object',
  properties: {
    prefix: { type: 'string', description: 'Project prefix (must be unique, e.g. HERALD)' },
    path: { type: 'string', description: 'Absolute path to the project root' },
    storage: {
      type: 'string',
      enum: ['global', 'local'],
      description: 'Storage mode (default: global)',
    },
  },
  required: ['prefix', 'path'],
} as const;

interface ValidatedInput {
  prefix: string;
  path: string;
  storage?: 'global' | 'local';
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw['prefix'] !== 'string' || !raw['prefix']) {
    throw new McpTasksError('INVALID_FIELD', 'prefix is required and must be a string');
  }
  if (typeof raw['path'] !== 'string' || !raw['path']) {
    throw new McpTasksError('INVALID_FIELD', 'path is required and must be a string');
  }
  if (
    raw['storage'] !== undefined &&
    raw['storage'] !== 'global' &&
    raw['storage'] !== 'local'
  ) {
    throw new McpTasksError('INVALID_FIELD', "storage must be 'global' or 'local'");
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  // Check prefix uniqueness
  const existing = ctx.config.projects.find(p => p.prefix === input.prefix);
  if (existing) {
    // Idempotent: already registered
    return ok({ registered: true, prefix: input.prefix, already_existed: true });
  }

  ctx.config.projects.push({
    prefix: input.prefix,
    path: input.path,
    storage: input.storage ?? 'global',
  });

  // Persist config
  const configPath =
    process.env['MCP_TASKS_CONFIG'] ??
    path.join(os.homedir(), '.config', 'mcp-tasks', 'config.json');
  const configDir = path.dirname(configPath);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(ctx.config, null, 2), 'utf-8');

  return ok({ registered: true, prefix: input.prefix, already_existed: false });
}
