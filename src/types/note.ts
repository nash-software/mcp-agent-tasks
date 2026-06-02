export interface NoteRecord {
  id: string;
  body: string;
  project: string;
  task_id: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface NoteCreateInput {
  body: string;
  project?: string;
  task_id?: string;
  tags?: string[];
}

export interface NoteUpdateInput {
  body?: string;
  tags?: string[];
}

export interface NoteListInput {
  project?: string;
  task_id?: string;
  limit?: number;
}

export const MAX_NOTE_BODY_LENGTH = 10_000;
export const MAX_NOTE_TAGS = 20;
export const DEFAULT_NOTE_LIST_LIMIT = 50;
export const MAX_NOTE_LIST_LIMIT = 200;
export const MAX_NOTE_SEARCH_RESULTS = 20;
