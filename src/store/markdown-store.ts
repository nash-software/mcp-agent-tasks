import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { stringify as yamlStringify } from 'yaml';
import type { Task, TaskFrontmatter } from '../types/task.js';
import { McpTasksError } from '../types/errors.js';

const SCHEMA_VERSION = 1;
const MAX_TRANSITIONS = 100;
const MAX_COMMITS = 50;

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

    const fm = parsed.data as Partial<TaskFrontmatter>;

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

    const task: Task = {
      schema_version: fm.schema_version,
      id: fm.id,
      title: fm.title,
      type: fm.type,
      status: fm.status,
      priority: fm.priority,
      project: fm.project,
      tags: fm.tags ?? [],
      complexity: fm.complexity ?? 1,
      complexity_manual: fm.complexity_manual ?? false,
      why: fm.why ?? '',
      created: fm.created ?? new Date().toISOString(),
      updated: fm.updated ?? new Date().toISOString(),
      last_activity: fm.last_activity ?? new Date().toISOString(),
      claimed_by: fm.claimed_by ?? null,
      claimed_at: fm.claimed_at ?? null,
      claim_ttl_hours: fm.claim_ttl_hours ?? 4,
      parent: fm.parent ?? null,
      children: fm.children ?? [],
      dependencies: fm.dependencies ?? [],
      subtasks: fm.subtasks ?? [],
      git: fm.git ?? { commits: [] },
      transitions: fm.transitions ?? [],
      files: fm.files ?? [],
      body: parsed.content.trim(),
      file_path: filePath,
    };

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

    const { body, file_path, ...frontmatter } = taskToWrite;

    const yamlStr = yamlStringify(frontmatter, {
      lineWidth: 0,
      defaultKeyType: 'PLAIN',
      defaultStringType: 'PLAIN',
    });

    const content = `---\n${yamlStr}---\n\n${body}\n`;

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
