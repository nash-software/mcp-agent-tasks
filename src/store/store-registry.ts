import path from 'node:path';
import type { McpTasksConfig } from '../config/loader.js';
import type { TaskCreateInput, TaskUpdateInput } from '../types/tools.js';
import type { TaskStatus, Task } from '../types/task.js';
import { McpTasksError } from '../types/errors.js';
import type { MarkdownStore } from './markdown-store.js';
import type { SqliteIndex } from './sqlite-index.js';
import type { ManifestWriter } from './manifest-writer.js';
import { TaskStore } from './task-store.js';

/**
 * StoreRegistry holds one TaskStore per unique tasksDir.
 * Projects sharing the same tasksDir (e.g. two global-storage projects)
 * share a single TaskStore instance.
 *
 * It also implements the TaskStore public interface by delegating each
 * method to the correct inner store (routed by prefix or task ID).
 */
export class StoreRegistry {
  private tasksDirMap: Map<string, string> = new Map();
  private storeMap: Map<string, TaskStore> = new Map();
  private config: McpTasksConfig;

  constructor(
    config: McpTasksConfig,
    sqliteIndex: SqliteIndex,
    markdownStore: MarkdownStore,
    manifestWriter: ManifestWriter,
  ) {
    this.config = config;
    // Map from tasksDir → TaskStore (used for deduplication during construction)
    const storeByDir = new Map<string, TaskStore>();

    for (const entry of config.projects) {
      const tasksDir = this.resolveTasksDir(entry.path, entry.storage);
      this.tasksDirMap.set(entry.prefix, tasksDir);

      let store = storeByDir.get(tasksDir);
      if (!store) {
        // Use the first prefix that maps to this dir as the project label
        store = new TaskStore(markdownStore, sqliteIndex, manifestWriter, tasksDir, entry.prefix);
        storeByDir.set(tasksDir, store); // eslint-disable-line -- storeByDir is only used during construction
      }
      this.storeMap.set(entry.prefix, store);
    }
  }

  private resolveTasksDir(projectPath: string, storage: string): string {
    if (storage === 'global') {
      return this.config.storageDir;
    }
    return path.join(projectPath, this.config.tasksDirName);
  }

  // ---------------------------------------------------------------------------
  // Prefix / ID lookup
  // ---------------------------------------------------------------------------

  getStoreForPrefix(prefix: string): TaskStore {
    const store = this.storeMap.get(prefix);
    if (!store) {
      throw new McpTasksError('PROJECT_NOT_FOUND', `No project registered with prefix: ${prefix}`);
    }
    return store;
  }

  getStoreForTaskId(id: string): TaskStore {
    const match = /^([A-Z]+)-\d+/.exec(id);
    if (!match) {
      throw new McpTasksError('TASK_NOT_FOUND', `Cannot parse prefix from task ID: ${id}`);
    }
    return this.getStoreForPrefix(match[1]);
  }

  getTasksDirForPrefix(prefix: string): string {
    const dir = this.tasksDirMap.get(prefix);
    if (!dir) {
      throw new McpTasksError('PROJECT_NOT_FOUND', `No project registered with prefix: ${prefix}`);
    }
    return dir;
  }

  allTasksDirs(): string[] {
    return [...new Set(this.tasksDirMap.values())];
  }

  allStores(): TaskStore[] {
    // Return unique store instances (deduplication by reference)
    const seen = new Set<TaskStore>();
    for (const store of this.storeMap.values()) {
      seen.add(store);
    }
    return [...seen];
  }

  getDefaultStore(): TaskStore {
    if (this.config.projects.length === 0) {
      throw new McpTasksError('PROJECT_NOT_FOUND', 'No projects configured');
    }
    return this.getStoreForPrefix(this.config.projects[0].prefix);
  }

  // ---------------------------------------------------------------------------
  // TaskStore public interface — delegation
  // ---------------------------------------------------------------------------

  createTask(input: TaskCreateInput): Task {
    return this.getStoreForPrefix(input.project).createTask(input);
  }

  updateTask(id: string, fields: TaskUpdateInput): Task {
    return this.getStoreForTaskId(id).updateTask(id, fields);
  }

  transitionTask(id: string, to: TaskStatus, reason?: string): Task {
    return this.getStoreForTaskId(id).transitionTask(id, to, reason);
  }

  claimTask(id: string, sessionId: string, ttlHours?: number): { claimed: boolean; task: Task } {
    return this.getStoreForTaskId(id).claimTask(id, sessionId, ttlHours);
  }

  releaseTask(id: string, sessionId: string): boolean {
    return this.getStoreForTaskId(id).releaseTask(id, sessionId);
  }

  archiveTask(id: string): void {
    return this.getStoreForTaskId(id).archiveTask(id);
  }
}
