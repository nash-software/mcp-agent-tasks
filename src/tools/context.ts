import type { TaskStore } from '../store/task-store.js';
import type { SqliteIndex } from '../store/sqlite-index.js';
import type { McpTasksConfig } from '../config/loader.js';

export interface ToolContext {
  store: TaskStore;
  index: SqliteIndex;
  sessionId: string;
  config: McpTasksConfig;
}

export type ToolOutput = { content: Array<{ type: 'text'; text: string }> };

export function ok(data: unknown): ToolOutput {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function err(code: string, message: string): ToolOutput {
  return { content: [{ type: 'text', text: JSON.stringify({ error: code, message }) }] };
}
