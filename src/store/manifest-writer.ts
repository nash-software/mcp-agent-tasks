import fs from 'node:fs';
import path from 'node:path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import type { Task, TaskStatus, TaskType, Priority } from '../types/task.js';

export interface ManifestEntry {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: Priority;
  complexity: number;
  parent: string | null;
  children: string[];
  dependencies: string[];
  subtask_progress: string; // e.g. "2/3"
  has_pr: boolean;
  last_activity: string;
  file: string;
}

function buildEntry(task: Task): ManifestEntry {
  const done = task.subtasks.filter(s => s.status === 'done').length;
  const total = task.subtasks.length;
  const subtask_progress = total > 0 ? `${done}/${total}` : '0/0';

  return {
    id: task.id,
    title: task.title,
    type: task.type,
    status: task.status,
    priority: task.priority,
    complexity: task.complexity,
    parent: task.parent,
    children: task.children,
    dependencies: task.dependencies,
    subtask_progress,
    has_pr: task.git.pr !== undefined,
    last_activity: task.last_activity,
    file: task.file_path,
  };
}

export class ManifestWriter {
  write(tasksDir: string, tasks: Task[], _nextId: number, _project: string): void {
    const entries = tasks.map(buildEntry);

    const manifest = {
      generated: new Date().toISOString(),
      count: entries.length,
      tasks: entries,
    };

    const yamlContent = yamlStringify(manifest, { lineWidth: 0 });

    const tmpPath = path.join(tasksDir, 'index.yaml.tmp');
    const finalPath = path.join(tasksDir, 'index.yaml');

    fs.writeFileSync(tmpPath, yamlContent, 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  }

  read(tasksDir: string): ManifestEntry[] {
    const filePath = path.join(tasksDir, 'index.yaml');
    if (!fs.existsSync(filePath)) return [];

    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = yamlParse(raw) as { tasks?: ManifestEntry[] } | null;

    if (!parsed || !parsed.tasks) return [];
    return parsed.tasks;
  }
}
