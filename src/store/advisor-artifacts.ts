/**
 * Artifact store — living versioned documents produced by plays.
 *
 * Path: ~/.mcp-tasks/advisor-sessions/artifacts.jsonl
 *
 * Key invariant: versions[] is append-only. appendVersion() never overwrites existing versions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Artifact, ArtifactKind } from '../types/advisor.js';

function artifactsDir(): string {
  const base = process.env['MCP_TASKS_DIR'] ?? join(homedir(), '.mcp-tasks');
  return join(base, 'advisor-sessions');
}

function artifactsPath(): string {
  return join(artifactsDir(), 'artifacts.jsonl');
}

function readAll(): Artifact[] {
  const p = artifactsPath();
  if (!existsSync(p)) return [];
  try {
    const lines = readFileSync(p, 'utf-8').split('\n').filter(l => l.trim() !== '');
    const results: Artifact[] = [];
    for (const line of lines) {
      try { results.push(JSON.parse(line) as Artifact); } catch { /* skip malformed */ }
    }
    return results;
  } catch {
    return [];
  }
}

function writeAll(artifacts: Artifact[]): void {
  const p = artifactsPath();
  mkdirSync(artifactsDir(), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  writeFileSync(tmp, artifacts.map(a => JSON.stringify(a)).join('\n') + (artifacts.length > 0 ? '\n' : ''), 'utf-8');
  renameSync(tmp, p);
}

/** List all artifacts, optionally filtered by kind. */
export async function listArtifacts(kind?: ArtifactKind): Promise<Artifact[]> {
  const all = readAll();
  return kind !== undefined ? all.filter(a => a.kind === kind) : all;
}

/** Get a single artifact by id. Returns null if not found. */
export async function getArtifact(id: string): Promise<Artifact | null> {
  return readAll().find(a => a.id === id) ?? null;
}

/** Create a new artifact. Throws if id already exists. */
export async function createArtifact(artifact: Artifact): Promise<void> {
  const all = readAll();
  if (all.some(a => a.id === artifact.id)) {
    throw new Error(`Artifact ${artifact.id} already exists — use appendVersion to add a version`);
  }
  all.push(artifact);
  writeAll(all);
}

/**
 * Append a new version to an existing artifact's versions[].
 * Never overwrites — versions[] is append-only (invariant #4).
 * Throws if artifact not found.
 */
export async function appendVersion(id: string, version: { ts: string; body: string }): Promise<void> {
  const all = readAll();
  const idx = all.findIndex(a => a.id === id);
  if (idx < 0) throw new Error(`Artifact ${id} not found`);
  const artifact = all[idx];
  if (!artifact) throw new Error(`Artifact ${id} not found`);
  all[idx] = {
    ...artifact,
    versions: [...artifact.versions, version],
    updated_at: version.ts,
  };
  writeAll(all);
}
