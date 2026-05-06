import type { SqliteIndex } from '../store/sqlite-index.js';
import type { McpTasksConfig } from '../config/loader.js';
import type { MilestoneRepository } from '../store/milestone-repository.js';
import type { StoreRegistry } from '../store/store-registry.js';

export interface ToolContext {
  store: StoreRegistry;
  registry: StoreRegistry;
  index: SqliteIndex;
  sessionId: string;
  config: McpTasksConfig;
  milestones: MilestoneRepository;
}

export type ToolOutput = { content: Array<{ type: 'text'; text: string }> };

export function ok(data: unknown): ToolOutput {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function err(code: string, message: string): ToolOutput {
  return { content: [{ type: 'text', text: JSON.stringify({ error: code, message }) }] };
}
