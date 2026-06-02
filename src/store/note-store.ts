import fs from 'node:fs';
import path from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import type { McpTasksConfig } from '../config/loader.js';
import type { NoteRecord, NoteCreateInput, NoteUpdateInput, NoteListInput } from '../types/note.js';
import { MAX_NOTE_BODY_LENGTH, MAX_NOTE_TAGS } from '../types/note.js';
import { McpTasksError } from '../types/errors.js';
import type { SqliteIndex } from './sqlite-index.js';
import { syncNoteToBrain } from '../lib/brain-sync.js';

export class NoteStore {
  constructor(
    private sqliteIndex: SqliteIndex,
    private config: McpTasksConfig,
  ) {}

  resolveNotesDir(project: string): string {
    const entry = this.config.projects.find(p => p.prefix === project);
    if (!entry) {
      // Fall back to global storage notes dir
      return path.join(this.config.storageDir, 'notes');
    }
    if (entry.storage === 'global') {
      return path.join(this.config.storageDir, 'notes');
    }
    return path.join(entry.path, 'notes');
  }

  create(input: NoteCreateInput, defaultProject: string): NoteRecord {
    const project = input.project ?? defaultProject;
    const body = (input.body ?? '').trim();
    const tags = input.tags ?? [];
    const task_id = input.task_id ?? null;

    this.validateBody(body);
    this.validateTags(tags);

    if (task_id !== null) {
      this.validateTaskExists(task_id);
    }

    const num = this.sqliteIndex.nextNoteId(project);
    const id = `${project}-N-${String(num).padStart(3, '0')}`;
    const now = new Date().toISOString();

    const note: NoteRecord = {
      id,
      body,
      project,
      task_id,
      tags,
      created_at: now,
      updated_at: now,
    };

    const notesDir = this.resolveNotesDir(project);
    fs.mkdirSync(notesDir, { recursive: true });

    this.sqliteIndex.upsertNote(note);
    this.writeMarkdown(note, notesDir);

    // Fire-and-forget brain sync — does not block note creation
    syncNoteToBrain(note, this.sqliteIndex);

    return note;
  }

  update(id: string, fields: NoteUpdateInput): NoteRecord {
    const existing = this.sqliteIndex.getNote(id);
    if (!existing) {
      throw new McpTasksError('NOTE_NOT_FOUND', `Note not found: ${id}`);
    }

    if (fields.body !== undefined) {
      this.validateBody(fields.body.trim());
      existing.body = fields.body.trim();
    }
    if (fields.tags !== undefined) {
      this.validateTags(fields.tags);
      existing.tags = fields.tags;
    }

    existing.updated_at = new Date().toISOString();

    const notesDir = this.resolveNotesDir(existing.project);
    fs.mkdirSync(notesDir, { recursive: true });

    this.sqliteIndex.upsertNote(existing);
    this.writeMarkdown(existing, notesDir);

    // Fire-and-forget brain sync
    syncNoteToBrain(existing, this.sqliteIndex);

    return existing;
  }

  linkTask(noteId: string, taskId: string): NoteRecord {
    const existing = this.sqliteIndex.getNote(noteId);
    if (!existing) {
      throw new McpTasksError('NOTE_NOT_FOUND', `Note not found: ${noteId}`);
    }

    this.validateTaskExists(taskId);

    const now = new Date().toISOString();
    this.sqliteIndex.linkNoteToTask(noteId, taskId, now);

    existing.task_id = taskId;
    existing.updated_at = now;

    const notesDir = this.resolveNotesDir(existing.project);
    this.writeMarkdown(existing, notesDir);

    return existing;
  }

  get(id: string): NoteRecord {
    const note = this.sqliteIndex.getNote(id);
    if (!note) {
      throw new McpTasksError('NOTE_NOT_FOUND', `Note not found: ${id}`);
    }
    return note;
  }

  list(opts: NoteListInput = {}): NoteRecord[] {
    return this.sqliteIndex.listNotes(opts);
  }

  search(q: string, project?: string): NoteRecord[] {
    return this.sqliteIndex.searchNotes(q, project);
  }

  private validateBody(body: string): void {
    if (!body) {
      throw new McpTasksError('INVALID_FIELD', 'body is required and must not be empty');
    }
    if (body.length > MAX_NOTE_BODY_LENGTH) {
      throw new McpTasksError(
        'INVALID_FIELD',
        `body must be ${MAX_NOTE_BODY_LENGTH} characters or fewer (got ${body.length})`,
      );
    }
  }

  private validateTags(tags: string[]): void {
    if (tags.length > MAX_NOTE_TAGS) {
      throw new McpTasksError('INVALID_FIELD', `tags must have ${MAX_NOTE_TAGS} or fewer items`);
    }
    for (const tag of tags) {
      if (typeof tag !== 'string' || !tag.trim()) {
        throw new McpTasksError('INVALID_FIELD', 'each tag must be a non-empty string');
      }
    }
  }

  private validateTaskExists(taskId: string): void {
    const task = this.sqliteIndex.getTask(taskId);
    if (!task) {
      throw new McpTasksError('TASK_NOT_FOUND', `Task not found: ${taskId}`);
    }
  }

  private writeMarkdown(note: NoteRecord, notesDir: string): void {
    const frontmatter = {
      id: note.id,
      project: note.project,
      task_id: note.task_id,
      tags: note.tags,
      created_at: note.created_at,
      updated_at: note.updated_at,
    };

    const content = `---\n${yamlStringify(frontmatter).trimEnd()}\n---\n\n${note.body}\n`;
    const filePath = path.join(notesDir, `${note.id}.md`);
    const tmpPath = `${filePath}.tmp`;

    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }
}
