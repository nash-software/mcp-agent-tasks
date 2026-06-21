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
import type { StateLogEntry, StateClassification, GateResult, RunLLM } from '../types/advisor.js';

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

// ── State classifier (T1.3) ────────────────────────────────────────────────

// Rumination: repeating circular language with no forward movement
const RUMINATION_RE = /\b(keep|going|same thing|over and over|in circles|can't stop|spiral|stuck in my head|replaying|again and again|keeps coming back|can't let go)\b/i;
// High arousal / acute distress — leading \b only so suffix forms match (overwhelmed, panicking, etc.)
const DISTRESS_RE = /\b(overwhelm|can't breathe|panic|heart racing|shak|flood|shutdown|too much|can't cope|paralys|frozen|spiralling|spinning)/i;
// Crisis language — triggers refer path (highest priority)
const CRISIS_RE = /\b(can't go on|no point|want to die|end it|suicid|harm myself|don't want to be here|hurt myself|not worth living|kill myself|take my (own )?life)\b/i;

function heuristicClassify(message: string): StateClassification {
  if (CRISIS_RE.test(message)) {
    return { mode: 'ruminating', arousal: 0.95, valence: -0.9, triggers: ['crisis-language'] };
  }
  if (DISTRESS_RE.test(message)) {
    return { mode: 'ruminating', arousal: 0.75, valence: -0.7, triggers: ['distress-language'] };
  }
  if (RUMINATION_RE.test(message)) {
    return { mode: 'ruminating', arousal: 0.6, valence: -0.4, triggers: ['rumination-language'] };
  }
  return { mode: 'processing', arousal: 0.3, valence: 0.1 };
}

/**
 * Classify the user's state for a single turn.
 *
 * Strategy: heuristic pre-filter first; if heuristic finds something notable,
 * confirm with a cheap LLM call. If `runLLM` fails (CLAUDE_CLI_DISABLED=1, binary
 * not found, network error), falls back to heuristic result gracefully.
 *
 * Expected `runLLM` JSON response format:
 *   {"mode":"processing"|"ruminating"|"grounded"|"flat","arousal":0.3,"valence":0.1,"triggers":["..."]}
 */
export async function classifyState(
  message: string,
  recent: StateLogEntry[],
  runLLM: RunLLM,
): Promise<StateClassification> {
  const heuristic = heuristicClassify(message);

  // Only invoke LLM when heuristic flags something — saves tokens on normal turns.
  if (heuristic.mode === 'processing' && (heuristic.arousal ?? 0) < 0.5) {
    return heuristic;
  }

  const recentSummary = recent.slice(-3).map(e => `${e.mode} arousal=${e.arousal}`).join(', ') || 'none';
  const prompt = [
    'You are a state classifier. Given a user message, return a JSON object with:',
    '  mode: "processing"|"ruminating"|"grounded"|"flat"',
    '  arousal: 0..1 (nervous system activation)',
    '  valence: -1..1 (negative to positive)',
    '  triggers: string[] (optional — key phrases)',
    '',
    `Recent state: ${recentSummary}`,
    '',
    `User message: "${message.slice(0, 500)}"`,
    '',
    'Respond with ONLY valid JSON, no explanation.',
  ].join('\n');

  try {
    const raw = await runLLM(prompt, { tier: 'cheap' });
    const jsonMatch = /\{[\s\S]*\}/.exec(raw);
    if (!jsonMatch) return heuristic;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<StateClassification>;
    const VALID_MODES = new Set(['processing', 'ruminating', 'grounded', 'flat']);
    if (typeof parsed.mode !== 'string' || !VALID_MODES.has(parsed.mode)) return heuristic;
    return {
      mode: parsed.mode as StateClassification['mode'],
      arousal: typeof parsed.arousal === 'number' ? Math.max(0, Math.min(1, parsed.arousal)) : heuristic.arousal,
      valence: typeof parsed.valence === 'number' ? Math.max(-1, Math.min(1, parsed.valence)) : heuristic.valence,
      triggers: Array.isArray(parsed.triggers) ? parsed.triggers.map(String) : heuristic.triggers,
    };
  } catch {
    return heuristic; // graceful fallback on any LLM failure
  }
}

// ── State gate (T1.4) ──────────────────────────────────────────────────────

/** Number of consecutive high-arousal turns that trigger the refer path. */
const SUSTAINED_DISTRESS_THRESHOLD = 3;

/** Arousal level above which a single turn triggers grounding. */
const GROUND_AROUSAL_THRESHOLD = 0.65;

/**
 * Gate runs BEFORE play selection — invariant #2.
 * Determines whether to proceed, ground (force somatic_pendulation), or refer.
 *
 * Ordering (cannot be reordered):
 *   1. Crisis language → refer (overrides persona/preferences)
 *   2. Sustained high distress (N consecutive turns) → refer
 *   3. Ruminating OR high arousal → ground
 *   4. else → proceed
 */
export function gate(c: StateClassification, recent: StateLogEntry[]): GateResult {
  // Crisis language — highest priority, overrides everything
  if (c.triggers?.includes('crisis-language') || c.arousal >= 0.9) {
    return { action: 'refer', reason: 'Crisis language detected — refer path activated' };
  }

  // Sustained high distress across N consecutive turns
  const recentHighArousal = recent.slice(-SUSTAINED_DISTRESS_THRESHOLD)
    .filter(e => e.arousal >= GROUND_AROUSAL_THRESHOLD);
  if (recentHighArousal.length >= SUSTAINED_DISTRESS_THRESHOLD) {
    return { action: 'refer', reason: `Sustained distress across ${SUSTAINED_DISTRESS_THRESHOLD} turns` };
  }

  // Rumination or high arousal → ground
  if (c.mode === 'ruminating' || c.arousal >= GROUND_AROUSAL_THRESHOLD) {
    return { action: 'ground', reason: `State ${c.mode} (arousal ${c.arousal.toFixed(2)}) — activating grounding` };
  }

  return { action: 'proceed', reason: 'State within normal range' };
}
