/**
 * Entity store — CRUD for the four semantic entity types.
 * Populated ONLY by the consolidation pass (src/store/advisor-consolidation.ts).
 *
 * Paths:
 *   ~/.mcp-tasks/advisor-sessions/entities/beliefs.jsonl
 *   ~/.mcp-tasks/advisor-sessions/entities/fears.jsonl
 *   ~/.mcp-tasks/advisor-sessions/entities/values.jsonl
 *   ~/.mcp-tasks/advisor-sessions/entities/commitments.jsonl
 *
 * NOTE: The arbiter (duplicate/refinement/pivot logic) lives in advisor-consolidation.ts.
 *       This module provides CRUD only — no merge logic.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  EntityType,
  BeliefRecord,
  FearRecord,
  ValueRecord,
  CommitmentRecord,
} from '../types/advisor.js';

export type Entity = BeliefRecord | FearRecord | ValueRecord | CommitmentRecord;

function entitiesDir(): string {
  const base = process.env['MCP_TASKS_DIR'] ?? join(homedir(), '.mcp-tasks');
  return join(base, 'advisor-sessions', 'entities');
}

function entityFilename(type: EntityType): string {
  const map: Record<EntityType, string> = {
    belief: 'beliefs.jsonl',
    fear: 'fears.jsonl',
    value: 'values.jsonl',
    commitment: 'commitments.jsonl',
  };
  return join(entitiesDir(), map[type]);
}

function readAll(type: EntityType): Entity[] {
  const p = entityFilename(type);
  if (!existsSync(p)) return [];
  try {
    const lines = readFileSync(p, 'utf-8').split('\n').filter(l => l.trim() !== '');
    const results: Entity[] = [];
    for (const line of lines) {
      try { results.push(JSON.parse(line) as Entity); } catch { /* skip malformed */ }
    }
    return results;
  } catch {
    return [];
  }
}

function writeAll(type: EntityType, entities: Entity[]): void {
  const p = entityFilename(type);
  mkdirSync(entitiesDir(), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  writeFileSync(tmp, entities.map(e => JSON.stringify(e)).join('\n') + (entities.length > 0 ? '\n' : ''), 'utf-8');
  renameSync(tmp, p);
}

/** List all entities of a given type. */
export async function listEntities(type: EntityType): Promise<Entity[]> {
  return readAll(type);
}

/** Get a single entity by type and id. Returns null if not found. */
export async function getEntity(type: EntityType, id: string): Promise<Entity | null> {
  const all = readAll(type);
  return all.find(e => e.id === id) ?? null;
}

/**
 * Upsert an entity — replaces existing record with same id, or appends if new.
 * No merge/arbiter logic here; caller is responsible for entity shape.
 */
export async function upsertEntity(type: EntityType, entity: Entity): Promise<void> {
  const all = readAll(type);
  const idx = all.findIndex(e => e.id === entity.id);
  if (idx >= 0) {
    all[idx] = entity;
  } else {
    all.push(entity);
  }
  writeAll(type, all);
}
