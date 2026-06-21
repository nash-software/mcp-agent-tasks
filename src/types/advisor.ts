/**
 * Domain types for the Advisor session history and memory system.
 * PersonaId is the server-side canonical copy — parallel to the UI literal union in lib/advisor.ts.
 */

/** Advisor persona modes — must remain exactly 'pm'|'chairman'|'coach'. */
export type PersonaId = 'pm' | 'chairman' | 'coach';

// ── Coaching layer types (T0.1) ────────────────────────────────────────────

/** The 11 therapeutic framework plays available to the coach. */
export type PlayId =
  | 'ladder'
  | 'downward_arrow'
  | 'odyssey'
  | 'best_possible_self'
  | 'immunity'
  | 'focusing'
  | 'somatic_pendulation'
  | 'ifs_parts'
  | 'byron_katie'
  | 'fear_setting'
  | 'regret_min';

/** Living versioned document kinds produced by plays. */
export type ArtifactKind =
  | 'odyssey_plan'
  | 'immunity_map'
  | 'values_charter'
  | 'fear_map'
  | 'future_self_letter'
  | 'belief_ledger';

/** The four semantic entity types stored by the consolidation pass. */
export type EntityType = 'belief' | 'fear' | 'value' | 'commitment';

/** Life-cycle status of a semantic entity. */
export type EntityStatus = 'active' | 'softening' | 'reconciled' | 'dormant';

/** Nervous-system state classification for a turn. */
export type StateMode = 'processing' | 'ruminating' | 'grounded' | 'flat';

/** Affect/somatic marker detected on an episodic turn (open-ended string). */
export type StateTag = string;

/** Model-tier hint for Prism routing (deferred this phase — logged as [prism-stub] when ignored). */
export type PrismTier = 'cheap' | 'mid' | 'high';

/** A single verbatim turn stored in the episodic JSONL per-session file. */
export interface EpisodicRecord {
  id: string;
  session_id: string;
  ts: string;
  role: 'user' | 'assistant';
  content: string;
  play?: PlayId;
  state_tags?: StateTag[];
  charge?: number;       // 0..1 affective intensity
  open_loop?: boolean;
}

/**
 * Written by the arbiter on pivot — never overwritten; the evolution record is the value.
 * Summarises what changed between a prior belief framing and the new one.
 */
export interface TimeBoundSummary {
  text: string;           // e.g. "held as load-bearing until ~2026-02; now held more lightly"
  reconciled_at: string;
  prior_value: string;
  new_value: string;
}

/** A belief surfaced and tracked across sessions. */
export interface BeliefRecord {
  id: string;
  statement: string;      // "I'm not good enough"
  downward_arrow: string[];
  first_surfaced: string;
  last_surfaced: string;
  surfaced_count: number;
  status: EntityStatus;
  disconfirming_evidence: { ts: string; note: string; source_session: string }[];
  reconciliation?: TimeBoundSummary;  // written on pivot; never overwritten
  linked_fears?: string[];
  linked_commitments?: string[];
}

/** A fear with optional somatic markers surfaced across sessions. */
export interface FearRecord {
  id: string;
  name: string;
  body_location?: string;   // "throat", "chest"
  felt_age?: string;        // "about 7"
  origin?: string;
  what_shifts_it?: string[];
  sessions: string[];
  status: EntityStatus;
}

/** A terminal value surfaced via laddering. */
export interface ValueRecord {
  id: string;
  value: string;
  ladder: string[];
  source_session: string;
  confidence: number;
}

/** An Immunity-to-Change map stored from the immunity play. */
export interface CommitmentRecord {
  id: string;
  improvement_goal: string;
  counter_behaviours: string[];
  hidden_commitment: string;
  big_assumption: string;
  tests_run: { ts: string; test: string; outcome: string }[];
  status: EntityStatus;
}

/** One entry in the per-session state log (chartable nervous-system trend). */
export interface StateLogEntry {
  ts: string;
  session_id?: string;
  valence: number;        // -1..1
  arousal: number;        // 0..1 nervous-system activation
  mode: StateMode;
  somatic_notes?: string;
  triggers?: string[];
}

/** Injectable LLM runner seam — pass a mock in tests, real runner in production. */
export type RunLLM = (prompt: string, opts?: { tier?: PrismTier; cold?: boolean }) => Promise<string>;

/** Result of the per-turn state classifier. */
export interface StateClassification {
  mode: StateMode;
  arousal: number;   // 0..1
  valence: number;   // -1..1
  triggers?: string[];
}

/** Result of the state-gate decision (runs before play selection — invariant #2). */
export interface GateResult {
  action: 'proceed' | 'ground' | 'refer';
  reason: string;
}

/** A living versioned document produced by a play — append-only versions[]. */
export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  created_at: string;
  updated_at: string;
  versions: { ts: string; body: string }[];
  linked_entities: string[];
}

/** A completed advisor conversation session persisted to sessions.jsonl. */
export interface AdvisorSession {
  /** Stable unique identifier (nanoid or uuid). */
  id: string;
  /** Persona mode active during this session. */
  mode: PersonaId;
  /** ISO-8601 timestamp when the session started. */
  started_at: string;
  /** ISO-8601 timestamp when the session closed. */
  ended_at: string;
  /** The goal snapshot text from the advisor system prompt at session start (sanitized). */
  goal_snapshot: string;
  /** LLM-extracted session summary, or null if reflection failed/not yet run. */
  summary: string | null;
  /** The full conversation log (user + assistant turns). Capped at 200 entries server-side. */
  full_log: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** IDs of AdvisorMemory entries created from this session's reflection. */
  insights_promoted: string[];
}

/** A durable fact learned about the user, extracted from advisor session reflections or saved by the user. */
export interface AdvisorMemory {
  /** Stable unique identifier (uuid). */
  id: string;
  /** The memory content text (≤150 chars). */
  content: string;
  /** How this memory was created: 'reflection' = extracted from session, 'user' = saved manually. */
  source: 'reflection' | 'user';
  /** ID of the AdvisorSession that produced this memory. Optional for user-saved memories. */
  source_session_id?: string;
  /** ISO-8601 timestamp when this memory was created. */
  created_at: string;
  /** ISO-8601 timestamp of the last time this memory was included in a chat context. */
  last_accessed_at: string;
  /** How many times this memory has been included in a chat context. */
  access_count: number;
  /** Whether the user has manually pinned this memory (exempt from decay). */
  pinned: boolean;
  /** Whether this memory has been faded by the decay algorithm. Faded memories are excluded from context. */
  faded: boolean;
}
