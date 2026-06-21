/**
 * Consolidation pass — episodic-to-semantic memory upgrade.
 *
 * Runs:
 *   1. On session close (triggered by server-ui.ts close handler) — T2.2
 *   2. Via POST /api/advisor/consolidate (manual / nightly cron) — T2.3
 *
 * NIGHTLY CRON (add to OS scheduler after T2.3 ships):
 *   0 3 * * * node -e "import('./dist/store/advisor-consolidation.js').then(m => m.consolidateAll())"
 *
 * RunLLM seam — every LLM call uses this injectable type so tests run under CLAUDE_CLI_DISABLED=1:
 *   type RunLLM = (prompt: string, opts?: { tier?: PrismTier; cold?: boolean }) => Promise<string>
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  RunLLM,
  EpisodicRecord,
  BeliefRecord,
  FearRecord,
  ValueRecord,
  CommitmentRecord,
  TimeBoundSummary,
} from '../types/advisor.js';
import { readEpisodic } from './advisor-episodic.js';
import { listEntities, upsertEntity } from './advisor-entities.js';

export type { RunLLM } from '../types/advisor.js';

// ── Paths ──────────────────────────────────────────────────────────────────

function sessionsDir(): string {
  const base = process.env['MCP_TASKS_DIR'] ?? join(homedir(), '.mcp-tasks');
  return join(base, 'advisor-sessions');
}

function consolidatedLogPath(): string {
  return join(sessionsDir(), 'consolidated.jsonl');
}

function episodicDir(): string {
  return join(sessionsDir(), 'episodic');
}

// ── Idempotency guard ─────────────────────────────────────────────────────

function readConsolidated(): Set<string> {
  const p = consolidatedLogPath();
  if (!existsSync(p)) return new Set();
  const ids = new Set<string>();
  try {
    const lines = readFileSync(p, 'utf-8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as { session_id?: string };
        if (rec.session_id) ids.add(rec.session_id);
      } catch { /* skip malformed */ }
    }
  } catch { /* file read error → treat as empty */ }
  return ids;
}

async function markConsolidated(sessionId: string): Promise<void> {
  const dir = sessionsDir();
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    consolidatedLogPath(),
    JSON.stringify({ session_id: sessionId, consolidated_at: new Date().toISOString() }) + '\n',
    'utf-8',
  );
}

// ── LLM entity extraction ─────────────────────────────────────────────────

interface ExtractedEntities {
  beliefs: Array<{ statement: string; downward_arrow?: string[] }>;
  fears: Array<{ name: string; body_location?: string; what_shifts_it?: string[] }>;
  values: Array<{ value: string; ladder?: string[] }>;
  commitments: Array<{ improvement_goal: string; counter_behaviours?: string[]; hidden_commitment?: string }>;
}

function buildExtractionPrompt(sessionText: string): string {
  return [
    'You are analyzing a coaching conversation. Extract typed entities expressed by the user.',
    'Reply ONLY with valid JSON in this exact shape (arrays may be empty):',
    '{',
    '  "beliefs": [{"statement": "...", "downward_arrow": ["..."]}],',
    '  "fears": [{"name": "...", "body_location": "...", "what_shifts_it": ["..."]}],',
    '  "values": [{"value": "...", "ladder": ["..."]}],',
    '  "commitments": [{"improvement_goal": "...", "counter_behaviours": ["..."], "hidden_commitment": "..."}]',
    '}',
    '',
    'Rules:',
    '- beliefs: core limiting or enabling beliefs stated or implied (e.g., "I am not capable enough")',
    '- fears: named fears, especially those with somatic markers',
    '- values: terminal values surfaced through laddering or direct statement',
    '- commitments: Immunity-to-Change patterns (what they keep meaning to do + what they do instead)',
    '- Only extract what is clearly present — do not infer or invent',
    '- Max 3 items per category',
    '',
    'Session (user turns only):',
    sessionText.slice(0, 3000),
  ].join('\n');
}

async function extractEntities(records: EpisodicRecord[], runLLM: RunLLM): Promise<ExtractedEntities | null> {
  const userText = records
    .filter(r => r.role === 'user')
    .map(r => r.content)
    .join('\n---\n');

  if (!userText.trim()) return null;

  try {
    const raw = await runLLM(buildExtractionPrompt(userText), { tier: 'mid', cold: true });
    const jsonMatch = /\{[\s\S]*\}/.exec(raw);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as ExtractedEntities;
  } catch {
    return null; // LLM unavailable or parse error — graceful fallback
  }
}

// ── Pivot detection ────────────────────────────────────────────────────────

// Simple heuristic: if the session text contains disconfirming language
// alongside a known belief topic, flag a potential pivot.
const DISCONFIRM_RE = /\b(actually|I realize|I was wrong|that's not true anymore|I used to think|I don't believe that any more|I see it differently|not as true as I thought)\b/i;

function detectPivotCandidate(records: EpisodicRecord[], belief: BeliefRecord): boolean {
  const userText = records.filter(r => r.role === 'user').map(r => r.content).join(' ');
  if (!DISCONFIRM_RE.test(userText)) return false;
  // Check if the belief's statement keywords appear in the same session
  const keywords = belief.statement.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  return keywords.some(kw => userText.toLowerCase().includes(kw));
}

// ── Arbiter — entity merge logic ───────────────────────────────────────────

async function mergeBeliefs(
  sessionId: string,
  candidates: ExtractedEntities['beliefs'],
  records: EpisodicRecord[],
): Promise<void> {
  if (candidates.length === 0) return;
  const existing = await listEntities('belief') as BeliefRecord[];
  const now = new Date().toISOString();

  for (const candidate of candidates) {
    if (!candidate.statement?.trim()) continue;

    // Match by case-insensitive statement similarity (first 60 chars)
    const key = candidate.statement.toLowerCase().slice(0, 60);
    const match = existing.find(e => e.statement.toLowerCase().slice(0, 60) === key);

    if (!match) {
      // New belief — create
      const newBelief: BeliefRecord = {
        id: `belief-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        statement: candidate.statement,
        downward_arrow: candidate.downward_arrow ?? [],
        first_surfaced: now,
        last_surfaced: now,
        surfaced_count: 1,
        status: 'active',
        disconfirming_evidence: [],
        linked_fears: [],
        linked_commitments: [],
      };
      await upsertEntity('belief', newBelief);
      existing.push(newBelief);
    } else {
      // Existing belief — update surfaced count + check for pivot
      const updated: BeliefRecord = {
        ...match,
        last_surfaced: now,
        surfaced_count: match.surfaced_count + 1,
      };

      // Pivot detection: disconfirming language + belief referenced
      if (match.status === 'active' && detectPivotCandidate(records, match)) {
        const summary: TimeBoundSummary = {
          text: `Held as ${JSON.stringify(match.statement)} until ~${now.slice(0, 7)}; user expressed disconfirmation in session ${sessionId}.`,
          reconciled_at: now,
          prior_value: match.statement,
          new_value: candidate.statement,
        };
        updated.status = 'softening'; // move toward reconciliation — not final yet
        updated.reconciliation = summary;
      }

      await upsertEntity('belief', updated);
      // Update local cache
      const idx = existing.findIndex(e => e.id === match.id);
      if (idx !== -1) existing[idx] = updated;
    }
  }
}

async function mergeFears(sessionId: string, candidates: ExtractedEntities['fears'], _records: EpisodicRecord[]): Promise<void> {
  if (candidates.length === 0) return;
  const existing = await listEntities('fear') as FearRecord[];

  for (const candidate of candidates) {
    if (!candidate.name?.trim()) continue;
    const key = candidate.name.toLowerCase().slice(0, 60);
    const match = existing.find(e => e.name.toLowerCase().slice(0, 60) === key);

    if (!match) {
      const newFear: FearRecord = {
        id: `fear-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: candidate.name,
        body_location: candidate.body_location,
        what_shifts_it: candidate.what_shifts_it ?? [],
        sessions: [sessionId],
        status: 'active',
      };
      await upsertEntity('fear', newFear);
    } else {
      const updated: FearRecord = {
        ...match,
        sessions: [...new Set([...match.sessions, sessionId])],
        what_shifts_it: [...new Set([...(match.what_shifts_it ?? []), ...(candidate.what_shifts_it ?? [])])],
      };
      await upsertEntity('fear', updated);
    }
  }
}

async function mergeValues(sessionId: string, candidates: ExtractedEntities['values'], _records: EpisodicRecord[]): Promise<void> {
  if (candidates.length === 0) return;
  const existing = await listEntities('value') as ValueRecord[];

  for (const candidate of candidates) {
    if (!candidate.value?.trim()) continue;
    const key = candidate.value.toLowerCase().slice(0, 60);
    const match = existing.find(e => e.value.toLowerCase().slice(0, 60) === key);

    if (!match) {
      const newValue: ValueRecord = {
        id: `value-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        value: candidate.value,
        ladder: candidate.ladder ?? [],
        source_session: sessionId,
        confidence: 0.7,
      };
      await upsertEntity('value', newValue);
    } else {
      const updated: ValueRecord = {
        ...match,
        confidence: Math.min(1, match.confidence + 0.1),
        ladder: [...new Set([...match.ladder, ...(candidate.ladder ?? [])])],
      };
      await upsertEntity('value', updated);
    }
  }
}

async function mergeCommitments(_sessionId: string, candidates: ExtractedEntities['commitments'], _records: EpisodicRecord[]): Promise<void> {
  if (candidates.length === 0) return;
  const existing = await listEntities('commitment') as CommitmentRecord[];

  for (const candidate of candidates) {
    if (!candidate.improvement_goal?.trim()) continue;
    const key = candidate.improvement_goal.toLowerCase().slice(0, 60);
    const match = existing.find(e => e.improvement_goal.toLowerCase().slice(0, 60) === key);

    if (!match) {
      const newCommitment: CommitmentRecord = {
        id: `commitment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        improvement_goal: candidate.improvement_goal,
        counter_behaviours: candidate.counter_behaviours ?? [],
        hidden_commitment: candidate.hidden_commitment ?? '',
        big_assumption: '',
        tests_run: [],
        status: 'active',
      };
      await upsertEntity('commitment', newCommitment);
    }
    // Existing commitment: no update in MVP — user manages manually via UI
  }
}

// ── T2.1: Arbiter ─────────────────────────────────────────────────────────

async function runArbiter(sessionId: string, records: EpisodicRecord[], runLLM: RunLLM): Promise<void> {
  const extracted = await extractEntities(records, runLLM);
  if (!extracted) return;

  // Merge each entity type — arbiter pivot invariant: existing records are
  // updated, never deleted; TimeBoundSummary is appended on pivot.
  await mergeBeliefs(sessionId, extracted.beliefs ?? [], records);
  await mergeFears(sessionId, extracted.fears ?? [], records);
  await mergeValues(sessionId, extracted.values ?? [], records);
  await mergeCommitments(sessionId, extracted.commitments ?? [], records);
}

// ── T2.2: consolidateSession ──────────────────────────────────────────────

/**
 * Consolidate a single session: extract candidate entities from the episodic log,
 * run the arbiter against existing entities, write results.
 *
 * Idempotent: if the session has already been consolidated, returns immediately.
 * Dedup is tracked in advisor-sessions/consolidated.jsonl.
 */
export async function consolidateSession(
  sessionId: string,
  runLLM: RunLLM,
): Promise<void> {
  // Idempotency guard — check before any work
  const done = readConsolidated();
  if (done.has(sessionId)) return;

  const records = await readEpisodic(sessionId);
  if (records.length > 0) {
    await runArbiter(sessionId, records, runLLM);
  }

  await markConsolidated(sessionId);
}

// ── T2.3: consolidateAll ──────────────────────────────────────────────────

/**
 * Consolidate ALL sessions that have not yet been processed.
 * Used by the nightly cron and the manual /api/advisor/consolidate endpoint.
 *
 * NIGHTLY CRON (add to OS scheduler after T2.3 ships):
 *   0 3 * * * node -e "import('./dist/store/advisor-consolidation.js').then(m => m.consolidateAll())"
 */
export async function consolidateAll(
  runLLM: RunLLM,
): Promise<{ processed: number; skipped: number }> {
  const done = readConsolidated();
  const epDir = episodicDir();

  if (!existsSync(epDir)) return { processed: 0, skipped: 0 };

  let processed = 0;
  let skipped = 0;

  const files = readdirSync(epDir).filter(f => f.endsWith('.jsonl'));
  for (const file of files) {
    const sessionId = file.replace(/\.jsonl$/, '');
    if (done.has(sessionId)) {
      skipped++;
      continue;
    }
    try {
      await consolidateSession(sessionId, runLLM);
      processed++;
    } catch {
      // Non-fatal: one session failure doesn't stop others
    }
  }

  return { processed, skipped };
}
