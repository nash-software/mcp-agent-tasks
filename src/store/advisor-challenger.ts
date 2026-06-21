/**
 * Challenger — disconfirmation subsystem.
 *
 * Runs as an isolated, cold LLM spawn with its own context — never sharing
 * instance with the coach to avoid inheriting sycophancy gradient.
 *
 * Hard gate: suppressed when state-gate action is 'ground' or 'refer'.
 * You do not challenge someone who is dysregulated (spec §5 + §6).
 *
 * Output: ChallengeResult | null (null = suppressed or LLM unavailable)
 * Caller emits a `challenge` SSE frame with the result.
 *
 * RunLLM seam: always called with `cold: true` to enforce isolation.
 */

import type { RunLLM, BeliefRecord } from '../types/advisor.js';

export interface ChallengeInput {
  message: string;
  beliefs: BeliefRecord[];
  gateAction: 'proceed' | 'ground' | 'refer';
}

export interface ChallengeResult {
  counterpoint: string;
  tests: string[];
}

const CHALLENGER_SYSTEM = `You are the Challenger — a disconfirmation function, not a coach. Your job is not to support or validate. Your job is to surface evidence against the current narrative, test core assumptions, and flag when the user is looping vs progressing.

Rules:
1. ONE counterpoint per response — clear and direct.
2. UP TO THREE tests — concrete experiments or questions that could falsify the narrative.
3. Do NOT use validating language ("I understand", "that makes sense").
4. Do NOT summarise what the user said.
5. Reply ONLY with valid JSON: {"counterpoint":"...", "tests":["...","..."]}`;

function buildChallengerPrompt(input: ChallengeInput): string {
  const beliefContext = input.beliefs.length > 0
    ? input.beliefs.map(b => {
        const arrows = b.downward_arrow.join(' → ');
        const evidence = b.disconfirming_evidence.length > 0
          ? `\nDisconfirming evidence on file: ${b.disconfirming_evidence.map(e => e.note).join('; ')}`
          : '';
        return `Belief: "${b.statement}"${arrows ? `\nArrow: ${arrows}` : ''}${evidence}`;
      }).join('\n\n')
    : '';

  return [
    CHALLENGER_SYSTEM,
    '',
    beliefContext ? `Relevant beliefs on file:\n${beliefContext}\n` : '',
    `User message: "${input.message.slice(0, 500)}"`,
    '',
    'Apply: (a) Byron Katie turnaround, (b) test the big assumption, (c) flag loop-vs-progress.',
    'Return ONLY valid JSON: {"counterpoint":"...","tests":["...","..."]}',
  ].filter(Boolean).join('\n');
}

/**
 * Run the Challenger against the current user message.
 *
 * Returns null when:
 *   - gateAction is 'ground' or 'refer' (MUST be suppressed per spec §5)
 *   - LLM unavailable (CLAUDE_CLI_DISABLED, ENOENT, timeout)
 *   - response cannot be parsed as ChallengeResult
 *
 * The `cold: true` flag in opts is mandatory — it signals to the RunLLM
 * implementation that this must be a fresh spawn with no session history.
 */
export async function runChallenger(
  input: ChallengeInput,
  runLLM: RunLLM,
): Promise<ChallengeResult | null> {
  // State-gate takes priority — never challenge a dysregulated person
  if (input.gateAction === 'ground' || input.gateAction === 'refer') {
    return null;
  }

  const prompt = buildChallengerPrompt(input);

  try {
    // cold: true = isolated, no shared session context with the coach
    const raw = await runLLM(prompt, { cold: true, tier: 'high' });
    const jsonMatch = /\{[\s\S]*\}/.exec(raw);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as Partial<ChallengeResult>;
    if (typeof parsed.counterpoint !== 'string' || !parsed.counterpoint.trim()) return null;

    return {
      counterpoint: parsed.counterpoint.trim().slice(0, 500),
      tests: Array.isArray(parsed.tests)
        ? parsed.tests.filter((t): t is string => typeof t === 'string').slice(0, 3)
        : [],
    };
  } catch {
    // Any failure → suppress gracefully; coach stream continues uninterrupted
    return null;
  }
}
