/**
 * State-log store — one entry per session turn, directly chartable.
 *
 * Path: ~/.mcp-tasks/advisor-sessions/state-log.jsonl
 *
 * The classifier (classifyState) is added in T1.3. This module (T0.4) provides
 * only the store: appendState / recentState / stateRange.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { StateLogEntry } from '../types/advisor.js';

function stateDir(): string {
  const base = process.env['MCP_TASKS_DIR'] ?? join(homedir(), '.mcp-tasks');
  return join(base, 'advisor-sessions');
}

function stateLogPath(): string {
  return join(stateDir(), 'state-log.jsonl');
}

function readAll(): StateLogEntry[] {
  const p = stateLogPath();
  if (!existsSync(p)) return [];
  try {
    const lines = readFileSync(p, 'utf-8').split('\n').filter(l => l.trim() !== '');
    const results: StateLogEntry[] = [];
    for (const line of lines) {
      try { results.push(JSON.parse(line) as StateLogEntry); } catch { /* skip malformed */ }
    }
    return results;
  } catch {
    return [];
  }
}

/** Append a single state-log entry. Uses appendFileSync — no read needed per write. */
export async function appendState(entry: StateLogEntry): Promise<void> {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  appendFileSync(stateLogPath(), JSON.stringify(entry) + '\n', 'utf-8');
}

/** Return the N most recent state-log entries (newest last). */
export async function recentState(n: number): Promise<StateLogEntry[]> {
  const all = readAll();
  return all.slice(-n);
}

/** Return all state-log entries whose ts falls within [fromTs, toTs] (ISO-8601 strings). */
export async function stateRange(fromTs: string, toTs: string): Promise<StateLogEntry[]> {
  const all = readAll();
  return all.filter(e => e.ts >= fromTs && e.ts <= toTs);
}
