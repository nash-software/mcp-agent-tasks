import type { Task, TaskStatus } from '../types/task.js';
import type { TaskCreateInput, TaskUpdateInput } from '../types/tools.js';
import { McpTasksError } from '../types/errors.js';
import { isValidTransition } from '../types/transitions.js';
import type { MarkdownStore } from './markdown-store.js';
import type { SqliteIndex } from './sqlite-index.js';
import type { ManifestWriter } from './manifest-writer.js';
import { TaskFactory } from './task-factory.js';
import { detectCycle } from './dependency-graph.js';

const DEFAULT_CLAIM_TTL_HOURS = 4;

// Fields allowed in updateTask
const ALLOWED_UPDATE_FIELDS = new Set([
  'title',
  'why',
  'priority',
  'tags',
  'files',
  'subtasks',
  'children',
  'dependencies',
  'git',
  'complexity',
  'complexity_manual',
  'spec_file',
  'plan_file',
  'milestone',
  'estimate_hours',
  'auto_captured',
  'references',
]);

export class TaskStore {
  private factory = new TaskFactory();

  constructor(
    private markdownStore: MarkdownStore,
    private sqliteIndex: SqliteIndex,
    private manifestWriter: ManifestWriter,
    private tasksDir: string,
    private project: string,
  ) {}

  createTask(input: TaskCreateInput): Task {
    // 1. Get next ID
    const num = this.sqliteIndex.nextId(input.project);

    // 2. Format ID
    const id = this.factory.formatId(input.project, num);

    // 3. Create task object
    const task = this.factory.create(input, id, this.tasksDir);

    // 4. Circular dependency check
    if (task.dependencies.length > 0) {
      const existingEdges = this.getExistingEdges();
      for (const dep of task.dependencies) {
        const newEdge: [string, string] = [id, dep];
        if (detectCycle(existingEdges, newEdge)) {
          throw new McpTasksError('CIRCULAR_DEPENDENCY', `Adding dependency ${dep} would create a cycle`);
        }
      }
    }

    // 5. SQLite upsert
    this.sqliteIndex.upsertTask(task);

    // 6. Markdown write
    this.markdownStore.write(task);

    // 7. Manifest update
    this.writeManifest();

    return task;
  }

  updateTask(id: string, fields: TaskUpdateInput): Task {
    // Reject status field
    if ('status' in fields) {
      throw new McpTasksError('INVALID_FIELD', 'Use transitionTask to change status');
    }

    // Validate allowed fields
    for (const key of Object.keys(fields)) {
      if (key === 'id') continue; // id is always in TaskUpdateInput
      if (!ALLOWED_UPDATE_FIELDS.has(key)) {
        throw new McpTasksError('INVALID_FIELD', `Field '${key}' is not allowed in updateTask`);
      }
    }

    // Load existing task
    const existing = this.sqliteIndex.getTask(id);
    if (!existing) {
      throw new McpTasksError('TASK_NOT_FOUND', `Task ${id} not found`);
    }

    // Merge allowed fields
    const updated: Task = { ...existing };

    if (fields.title !== undefined) updated.title = fields.title;
    if (fields.why !== undefined) updated.why = fields.why;
    if (fields.priority !== undefined) updated.priority = fields.priority;
    if (fields.tags !== undefined) updated.tags = fields.tags;
    if (fields.files !== undefined) updated.files = fields.files;
    if (fields.complexity !== undefined) {
      updated.complexity = fields.complexity;
      updated.complexity_manual = true;
    }

    // Extended fields — accessed via type-extended interfaces in tool layer
    const extended = fields as unknown as Record<string, unknown>;

    if (extended['dependencies'] !== undefined) {
      const newDeps = extended['dependencies'] as string[];
      // Cycle check: temporarily remove this task's edges from existing graph, then check each new dep
      const existingEdges = this.getExistingEdges().filter(([from]) => from !== id);
      for (const dep of newDeps) {
        const newEdge: [string, string] = [id, dep];
        if (detectCycle(existingEdges, newEdge)) {
          throw new McpTasksError('CIRCULAR_DEPENDENCY', `Adding dependency ${dep} to ${id} would create a cycle`);
        }
      }
      updated.dependencies = newDeps;
    }

    if (extended['subtasks'] !== undefined) updated.subtasks = extended['subtasks'] as Task['subtasks'];
    if (extended['children'] !== undefined) updated.children = extended['children'] as string[];
    if (extended['git'] !== undefined) updated.git = extended['git'] as Task['git'];

    if (extended['spec_file'] !== undefined) {
      if (existing.type !== 'spec') {
        throw new McpTasksError('INVALID_FIELD', "spec_file is only valid for type 'spec'");
      }
      updated.spec_file = extended['spec_file'] as string;
    }

    if (extended['plan_file'] !== undefined) updated.plan_file = extended['plan_file'] as string;
    if (extended['milestone'] !== undefined) updated.milestone = extended['milestone'] as string;
    if (extended['estimate_hours'] !== undefined) updated.estimate_hours = extended['estimate_hours'] as number;
    if (extended['auto_captured'] !== undefined) updated.auto_captured = extended['auto_captured'] as boolean;
    if (extended['references'] !== undefined) updated.references = extended['references'] as Task['references'];

    // Write protocol: SQLite → markdown → manifest
    this.sqliteIndex.upsertTask(updated);
    this.markdownStore.write(updated);
    this.writeManifest();

    return updated;
  }

  transitionTask(id: string, to: TaskStatus, reason?: string): Task {
    const existing = this.sqliteIndex.getTask(id);
    if (!existing) {
      throw new McpTasksError('TASK_NOT_FOUND', `Task ${id} not found`);
    }

    if (!isValidTransition(existing.status, to)) {
      throw new McpTasksError(
        'INVALID_TRANSITION',
        `Cannot transition ${id} from '${existing.status}' to '${to}'`,
      );
    }

    const now = new Date().toISOString();
    const transition = {
      from: existing.status,
      to,
      at: now,
      ...(reason ? { reason } : {}),
    };

    const updated: Task = {
      ...existing,
      status: to,
      transitions: [...existing.transitions, transition],
    };

    this.sqliteIndex.upsertTask(updated);
    this.markdownStore.write(updated);
    this.writeManifest();

    // Derive parent status if applicable
    if (updated.parent) {
      const derivedStatus = this.deriveParentStatus(updated.parent);
      if (derivedStatus !== null) {
        const parent = this.sqliteIndex.getTask(updated.parent);
        if (parent && isValidTransition(parent.status, derivedStatus)) {
          this.transitionTask(updated.parent, derivedStatus, 'Auto-derived from child status');
        }
      }
    }

    return updated;
  }

  claimTask(id: string, sessionId: string, ttlHours?: number): { claimed: boolean; task: Task } {
    const hours = ttlHours ?? DEFAULT_CLAIM_TTL_HOURS;

    const claimed = this.sqliteIndex.claimTask(id, sessionId, hours);

    if (!claimed) {
      const task = this.sqliteIndex.getTask(id);
      if (!task) throw new McpTasksError('TASK_NOT_FOUND', `Task ${id} not found`);
      return { claimed: false, task };
    }

    const task = this.sqliteIndex.getTask(id);
    if (!task) throw new McpTasksError('TASK_NOT_FOUND', `Task ${id} not found after claim`);

    // Update frontmatter
    this.markdownStore.write(task);
    this.writeManifest();

    return { claimed: true, task };
  }

  releaseTask(id: string, sessionId: string): boolean {
    const released = this.sqliteIndex.releaseTask(id, sessionId);

    if (released) {
      const task = this.sqliteIndex.getTask(id);
      if (task) {
        this.markdownStore.write(task);
        this.writeManifest();
      }
    }

    return released;
  }

  archiveTask(id: string): void {
    const existing = this.sqliteIndex.getTask(id);
    if (!existing) {
      throw new McpTasksError('TASK_NOT_FOUND', `Task ${id} not found`);
    }

    const now = new Date().toISOString();
    const archived: Task = {
      ...existing,
      status: 'archived',
      transitions: [
        ...existing.transitions,
        { from: existing.status, to: 'archived', at: now, reason: 'Archived' },
      ],
    };

    // Write protocol: bypass isValidTransition — archiving is an admin operation
    this.sqliteIndex.upsertTask(archived);
    this.markdownStore.write(archived);
    this.writeManifest();

    // Move markdown file to archive/
    this.markdownStore.delete(archived.file_path);
  }

  private deriveParentStatus(parentId: string): TaskStatus | null {
    const children = this.sqliteIndex.getChildTasks(parentId);
    if (!children.length) return null;
    if (children.some(c => c.status === 'blocked')) return 'blocked';
    if (children.every(c => c.status === 'done')) return 'done';
    if (children.some(c => c.status === 'in_progress')) return 'in_progress';
    return null;
  }

  private getExistingEdges(): Array<[string, string]> {
    const tasks = this.sqliteIndex.listTasks({ project: this.project, limit: 10000 });
    const edges: Array<[string, string]> = [];
    for (const task of tasks) {
      for (const dep of task.dependencies) {
        edges.push([task.id, dep]);
      }
    }
    return edges;
  }

  private writeManifest(): void {
    const tasks = this.sqliteIndex.listTasks({ project: this.project, limit: 10000 });
    const nextId = 0; // manifest-writer doesn't use this meaningfully yet
    this.manifestWriter.write(this.tasksDir, tasks, nextId, this.project);
  }
}
