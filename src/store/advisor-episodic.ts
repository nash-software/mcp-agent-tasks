/**
 * Episodic store — verbatim turn-by-turn records, never summarised at write time.
 *
 * Path: ~/.mcp-tasks/advisor-sessions/episodic/<session_id>.jsonl
 * Each line is one EpisodicRecord (JSON). No truncation, no summary.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { EpisodicRecord, PlayId } from '../types/advisor.js';

function episodicDir(): string {
  const base = process.env['MCP_TASKS_DIR'] ?? join(homedir(), '.mcp-tasks');
  return join(base, 'advisor-sessions', 'episodic');
}

function episodicPath(sessionId: string): string {
  return join(episodicDir(), `${sessionId}.jsonl`);
}

/** Append one verbatim turn to the session's episodic JSONL file. Never overwrites. */
export async function appendEpisodic(rec: EpisodicRecord): Promise<void> {
  const dir = episodicDir();
  mkdirSync(dir, { recursive: true });
  appendFileSync(episodicPath(rec.session_id), JSON.stringify(rec) + '\n', 'utf-8');
}

/** Read all episodic records for a session. Returns [] if file doesn't exist. */
export async function readEpisodic(sessionId: string): Promise<EpisodicRecord[]> {
  const p = episodicPath(sessionId);
  if (!existsSync(p)) return [];
  try {
    const lines = readFileSync(p, 'utf-8').split('\n').filter(l => l.trim() !== '');
    const results: EpisodicRecord[] = [];
    for (const line of lines) {
      try { results.push(JSON.parse(line) as EpisodicRecord); } catch { /* skip malformed */ }
    }
    return results;
  } catch {
    return [];
  }
}

export interface EpisodicQueryOpts {
  play?: PlayId;
  openLoops?: boolean;
  sinceTs?: string;
}

/**
 * Query episodic records across ALL sessions by optional filters.
 * Scans all session files — intended for consolidation pass and session-open ritual.
 */
export async function queryEpisodic(opts: EpisodicQueryOpts): Promise<EpisodicRecord[]> {
  const dir = episodicDir();
  if (!existsSync(dir)) return [];

  const { readdirSync } = await import('node:fs');
  const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'));

  const results: EpisodicRecord[] = [];
  for (const file of files) {
    try {
      const lines = readFileSync(join(dir, file), 'utf-8').split('\n').filter(l => l.trim() !== '');
      for (const line of lines) {
        try {
          const rec = JSON.parse(line) as EpisodicRecord;
          if (opts.play !== undefined && rec.play !== opts.play) continue;
          if (opts.openLoops === true && !rec.open_loop) continue;
          if (opts.sinceTs !== undefined && rec.ts < opts.sinceTs) continue;
          results.push(rec);
        } catch { /* skip malformed */ }
      }
    } catch { /* skip unreadable files */ }
  }
  return results;
}
