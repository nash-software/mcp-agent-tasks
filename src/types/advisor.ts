/**
 * Domain types for the Advisor session history and memory system.
 * PersonaId is the server-side canonical copy — parallel to the UI literal union in lib/advisor.ts.
 */

/** Advisor persona modes — must remain exactly 'pm'|'chairman'|'coach'. */
export type PersonaId = 'pm' | 'chairman' | 'coach';

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
