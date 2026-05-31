import fs from 'node:fs';
import path from 'node:path';
import { formatId } from './task-factory.js';

/**
 * One-time repair for `(id, project)` collisions — two different task files claiming the same id.
 * The index PK is (id, project), so on reconcile one silently masks the other (MCPAT-060). This
 * keeps both tasks: the canonical file keeps the id; each other file is re-IDed to a fresh unique id
 * (frontmatter `id` rewritten + file renamed). Pure planning is separated from disk mutation so the
 * plan can be reviewed (dry-run) before `apply`.
 */

export interface StoreRef {
  prefix: string;
  tasksDir: string;
}

export interface FileInfo {
  file: string;     // basename
  path: string;     // absolute path
  id: string;
  title: string;
  status: string;
  created: string;
  bodyLen: number;
}

export interface Reassignment extends FileInfo {
  newId: string;
  newFile: string;
}

export interface CollisionPlan {
  project: string;
  id: string;
  canonical: FileInfo;
  reassign: Reassignment[];
}

function parseFile(absPath: string, file: string): FileInfo | null {
  let txt: string;
  try {
    txt = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (mm) fm[mm[1]] = mm[2].replace(/^["']|["']$/g, '').trim();
  }
  if (!fm['id']) return null;
  const body = txt.slice(m[0].length).trim();
  return {
    file,
    path: absPath,
    id: fm['id'],
    title: fm['title'] ?? '',
    status: fm['status'] ?? '',
    created: fm['created'] ?? '',
    bodyLen: body.length,
  };
}

function scanStore(store: StoreRef): FileInfo[] {
  if (!fs.existsSync(store.tasksDir)) return [];
  const out: FileInfo[] = [];
  for (const file of fs.readdirSync(store.tasksDir)) {
    if (!file.endsWith('.md')) continue;
    const info = parseFile(path.join(store.tasksDir, file), file);
    if (info && info.id.startsWith(store.prefix + '-')) out.push(info);
  }
  return out;
}

function maxIdNum(infos: FileInfo[], prefix: string): number {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const i of infos) {
    const m = re.exec(i.id);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}

/**
 * Canonical = the file that KEEPS the id. Prefer a slug-named file (`<id>-slug.md`) over a bare
 * `<id>.md`, then a longer body, then the older `created`. Deterministic so the stable task is
 * never the one that moves.
 */
function canonicalFirst(a: FileInfo, b: FileInfo): number {
  const aSlug = a.file !== `${a.id}.md` ? 1 : 0;
  const bSlug = b.file !== `${b.id}.md` ? 1 : 0;
  if (aSlug !== bSlug) return bSlug - aSlug;
  if (a.bodyLen !== b.bodyLen) return b.bodyLen - a.bodyLen;
  return (a.created || '~').localeCompare(b.created || '~');
}

export function planCollisionFixes(stores: StoreRef[]): CollisionPlan[] {
  const plans: CollisionPlan[] = [];
  for (const store of stores) {
    const infos = scanStore(store);
    const byId = new Map<string, FileInfo[]>();
    for (const i of infos) {
      const g = byId.get(i.id);
      if (g) g.push(i);
      else byId.set(i.id, [i]);
    }
    let nextNum = maxIdNum(infos, store.prefix);
    for (const [id, group] of byId) {
      if (group.length < 2) continue;
      const sorted = [...group].sort(canonicalFirst);
      const canonical = sorted[0];
      const reassign: Reassignment[] = sorted.slice(1).map(info => {
        nextNum++;
        const newId = formatId(store.prefix, nextNum);
        return { ...info, newId, newFile: `${newId}.md` };
      });
      plans.push({ project: store.prefix, id, canonical, reassign });
    }
  }
  return plans;
}

/**
 * Apply a plan: for each reassignment, rewrite the frontmatter `id:` line and rename the file. Pure
 * frontmatter surgery (no full re-serialize) so nothing else in the file changes. Returns the count
 * of reassigned files. Idempotent: re-planning after apply yields no collisions.
 */
export function applyCollisionFixes(plans: CollisionPlan[]): { reassigned: number; renamed: Array<{ from: string; to: string; oldId: string; newId: string }> } {
  const renamed: Array<{ from: string; to: string; oldId: string; newId: string }> = [];
  for (const plan of plans) {
    for (const r of plan.reassign) {
      const txt = fs.readFileSync(r.path, 'utf-8');
      const updated = txt.replace(/^(id:\s*)["']?[^"'\r\n]+["']?(\s*)$/m, `$1${r.newId}$2`);
      if (!/^id:\s*/m.test(updated) || !updated.includes(r.newId)) {
        throw new Error(`Failed to rewrite id in ${r.path}`);
      }
      const newPath = path.join(path.dirname(r.path), r.newFile);
      if (fs.existsSync(newPath)) {
        throw new Error(`Refusing to overwrite existing file ${newPath}`);
      }
      fs.writeFileSync(newPath, updated, 'utf-8');
      if (path.resolve(newPath) !== path.resolve(r.path)) {
        fs.rmSync(r.path);
      }
      renamed.push({ from: r.file, to: r.newFile, oldId: r.id, newId: r.newId });
    }
  }
  return { reassigned: renamed.length, renamed };
}

/**
 * Find files that REFERENCE an old id elsewhere (subtask parent, blocked_by, closes/blocks, git) so
 * the operator can fix dangling refs after a reassignment. Reports only — never rewrites.
 */
export function findReferences(stores: StoreRef[], ids: string[]): Array<{ id: string; file: string }> {
  const idSet = new Set(ids);
  const hits: Array<{ id: string; file: string }> = [];
  for (const store of stores) {
    if (!fs.existsSync(store.tasksDir)) continue;
    for (const file of fs.readdirSync(store.tasksDir)) {
      if (!file.endsWith('.md')) continue;
      const abs = path.join(store.tasksDir, file);
      let txt: string;
      try { txt = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
      for (const id of idSet) {
        // Skip the colliding file itself (its own `id:` line) — only count references elsewhere.
        const re = new RegExp(`\\b${id}\\b`, 'g');
        const matches = txt.match(re) ?? [];
        const ownIdLine = new RegExp(`^id:\\s*["']?${id}["']?\\s*$`, 'm').test(txt);
        const threshold = ownIdLine ? 1 : 0;
        if (matches.length > threshold) hits.push({ id, file });
      }
    }
  }
  return hits;
}
