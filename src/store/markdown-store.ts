import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { stringify as yamlStringify } from 'yaml';
import type { Task, TaskFrontmatter, TaskReference, Area, AgentStatus } from '../types/task.js';
import { McpTasksError } from '../types/errors.js';
import { MAX_TRANSITIONS, MAX_COMMITS } from './limits.js';

const SCHEMA_VERSION = 1;

/**
 * gray-matter uses js-yaml which parses ISO date strings as Date objects.
 * Convert back to ISO string for storage.
 */
function toIsoString(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function toIsoStringOrNull(val: unknown): string | null {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return null;
}

/**
 * Convert a YAML-parsed date value back to YYYY-MM-DD.
 * js-yaml parses bare date strings (2026-06-01) as midnight UTC Date objects.
 * We reconstruct the date portion using UTC components to avoid timezone shifts.
 */
function toDateStringOrNull(val: unknown): string | null {
  if (typeof val === 'string') return val;
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

/** Validate that a value is an array of TaskReference entries. */
function parseReferences(raw: unknown): TaskReference[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: unknown, i: number) => {
    if (!item || typeof item !== 'object') {
      throw new McpTasksError('SCHEMA_MISMATCH', `references[${i}] must be an object`);
    }
    const r = item as Record<string, unknown>;
    if (!['closes', 'blocks', 'related'].includes(r['type'] as string)) {
      throw new McpTasksError('SCHEMA_MISMATCH', `references[${i}].type must be closes|blocks|related`);
    }
    if (typeof r['id'] !== 'string') {
      throw new McpTasksError('SCHEMA_MISMATCH', `references[${i}].id must be a string`);
    }
    return { type: r['type'] as TaskReference['type'], id: r['id'] };
  });
}

export class MarkdownStore {
  read(filePath: string): Task {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      throw new McpTasksError('TASK_NOT_FOUND', `Cannot read file: ${filePath}: ${String(err)}`);
    }

    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(raw);
    } catch (err) {
      throw new McpTasksError('SCHEMA_MISMATCH', `Failed to parse frontmatter in ${filePath}: ${String(err)}`);
    }

    const fm = parsed.data as Partial<TaskFrontmatter> & {
      labels?: string[];
      milestone?: string;
      estimate_hours?: number;
      plan_file?: string;
      auto_captured?: boolean;
      references?: unknown;
      area?: Area;
      scheduled_for?: string | Date | null;
      agent_status?: AgentStatus;
      block_reason?: string;
      triage_note?: string;
      triage_confidence?: number;
      closed_at?: number;
      close_batch?: string;
    };

    if (fm.schema_version !== SCHEMA_VERSION) {
      throw new McpTasksError(
        'SCHEMA_MISMATCH',
        `Expected schema_version ${SCHEMA_VERSION}, got ${String(fm.schema_version)} in ${filePath}`,
      );
    }

    // Ensure required fields are present
    if (!fm.id || !fm.title || !fm.type || !fm.status || !fm.priority || !fm.project) {
      throw new McpTasksError('SCHEMA_MISMATCH', `Missing required frontmatter fields in ${filePath}`);
    }

    // labels/tags alias: merge both arrays and deduplicate
    const merged = Array.from(new Set([...(fm.tags ?? []), ...(fm.labels ?? [])]));

    const task: Task = {
      schema_version: fm.schema_version,
      id: fm.id,
      title: fm.title,
      type: fm.type,
      status: fm.status,
      priority: fm.priority,
      project: fm.project,
      tags: merged,
      labels: merged,
      complexity: fm.complexity ?? 1,
      complexity_manual: fm.complexity_manual ?? false,
      why: fm.why ?? '',
      created: toIsoString(fm.created),
      updated: toIsoString(fm.updated),
      last_activity: toIsoString(fm.last_activity),
      claimed_by: fm.claimed_by ?? null,
      claimed_at: toIsoStringOrNull(fm.claimed_at),
      claim_ttl_hours: fm.claim_ttl_hours ?? 4,
      parent: fm.parent ?? null,
      children: fm.children ?? [],
      dependencies: fm.dependencies ?? [],
      subtasks: fm.subtasks ?? [],
      git: (() => {
        const g = fm.git ?? { commits: [] };
        return {
          ...g,
          commits: ((g.commits ?? []) as unknown as Record<string, unknown>[]).map((c) => ({
            ...c,
            authored_at: toIsoString(c['authored_at']),
          })) as import('../types/task.js').CommitRef[],
          pr: g.pr
            ? { ...g.pr, merged_at: toIsoStringOrNull(g.pr.merged_at) }
            : undefined,
        };
      })(),
      transitions: ((fm.transitions ?? []) as unknown as Record<string, unknown>[]).map((tr) => ({
        ...tr,
        at: toIsoString(tr['at']),
      })) as import('../types/task.js').StatusTransition[],
      files: fm.files ?? [],
      body: parsed.content.trim(),
      file_path: filePath,
      ...(fm.spec_file !== undefined ? { spec_file: fm.spec_file } : {}),
      ...(fm.plan_file !== undefined ? { plan_file: fm.plan_file } : {}),
      ...(fm.milestone !== undefined ? { milestone: fm.milestone } : {}),
      ...(fm.estimate_hours !== undefined ? { estimate_hours: fm.estimate_hours } : {}),
      ...(fm.auto_captured !== undefined ? { auto_captured: fm.auto_captured } : {}),
      ...(fm.area !== undefined ? { area: fm.area } : {}),
      ...(fm.scheduled_for !== undefined ? { scheduled_for: toDateStringOrNull(fm.scheduled_for) } : {}),
      ...(fm.agent_status !== undefined ? { agent_status: fm.agent_status } : {}),
      ...(fm.block_reason !== undefined ? { block_reason: fm.block_reason } : {}),
      ...(fm.triage_note !== undefined ? { triage_note: fm.triage_note } : {}),
      ...(fm.triage_confidence !== undefined ? { triage_confidence: fm.triage_confidence } : {}),
      ...(fm.closed_at !== undefined ? { closed_at: fm.closed_at } : {}),
      ...(fm.close_batch !== undefined ? { close_batch: fm.close_batch } : {}),
    };

    // Parse and validate references
    if (fm.references !== undefined) {
      task.references = parseReferences(fm.references);
    }

    return task;
  }

  write(task: Task): void {
    const now = new Date().toISOString();
    const taskToWrite: Task = {
      ...task,
      updated: now,
      last_activity: now,
      // Cap frontmatter arrays
      transitions: task.transitions.slice(-MAX_TRANSITIONS),
      git: {
        ...task.git,
        commits: task.git.commits.slice(-MAX_COMMITS),
      },
    };

    const { body, file_path, labels, ...frontmatter } = taskToWrite;

    // Write labels (not tags) as the canonical key going forward;
    // keep tags as labels alias for backward compat — write both for schema_version=1
    const { tags, ...restFrontmatter } = frontmatter;
    const frontmatterToWrite: Record<string, unknown> = {
      ...restFrontmatter,
      tags: tags, // keep tags for backward compat with existing readers
      labels: task.tags, // forward-compatible alias
    };

    // Only include optional new fields if defined
    if (task.milestone === undefined) delete frontmatterToWrite['milestone'];
    if (task.estimate_hours === undefined) delete frontmatterToWrite['estimate_hours'];
    if (task.plan_file === undefined) delete frontmatterToWrite['plan_file'];
    if (task.auto_captured === undefined) delete frontmatterToWrite['auto_captured'];
    if (task.references === undefined) delete frontmatterToWrite['references'];
    if (task.area === undefined) delete frontmatterToWrite['area'];
    if (task.scheduled_for === undefined || task.scheduled_for === null) delete frontmatterToWrite['scheduled_for'];
    if (task.agent_status === undefined) delete frontmatterToWrite['agent_status'];
    if (task.block_reason === undefined) delete frontmatterToWrite['block_reason'];
    if (task.triage_note === undefined) delete frontmatterToWrite['triage_note'];
    if (task.triage_confidence === undefined) delete frontmatterToWrite['triage_confidence'];

    // Remove labels/tags if both are empty to keep output clean
    if (!task.tags?.length) {
      delete frontmatterToWrite['labels'];
      delete frontmatterToWrite['tags'];
    }

    void labels; // suppress unused warning — we destructure to remove from spread

    const yamlStr = yamlStringify(frontmatterToWrite, {
      lineWidth: 0,
      defaultKeyType: 'PLAIN',
      defaultStringType: 'PLAIN',
    });

    const content = `---\n${yamlStr}---\n\n${body}\n`;

    // Belt-and-braces: if a different task already occupies this file path,
    // refuse to clobber. Same-id overwrites are the legitimate update path.
    if (fs.existsSync(file_path)) {
      try {
        const existing = matter(fs.readFileSync(file_path, 'utf-8'));
        const existingId = (existing.data as { id?: unknown })?.id;
        if (typeof existingId === 'string' && existingId !== task.id) {
          throw new McpTasksError(
            'TASK_FILE_EXISTS',
            `Refusing to overwrite ${file_path}: occupied by ${existingId}, would be replaced by ${task.id}`,
          );
        }
      } catch (err) {
        if (err instanceof McpTasksError) throw err;
        // Unparseable existing file — treat as foreign and refuse.
        throw new McpTasksError(
          'TASK_FILE_EXISTS',
          `Refusing to overwrite unparseable file ${file_path} with task ${task.id}`,
        );
      }
    }

    const dir = path.dirname(file_path);
    const tmpPath = path.join(dir, path.basename(file_path) + '.tmp');

    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, file_path);
  }

  delete(filePath: string): void {
    const dir = path.dirname(filePath);
    const archiveDir = path.join(dir, 'archive');

    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    const filename = path.basename(filePath);
    const archivePath = path.join(archiveDir, filename);

    fs.renameSync(filePath, archivePath);
  }
}
