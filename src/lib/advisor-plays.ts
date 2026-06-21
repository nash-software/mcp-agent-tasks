/**
 * Server-side play routing for the coach advisor.
 * Mirror of trigger_signals + safe_when_dysregulated from src/ui/src/advisor/plays/*.json.
 * Full play definitions (protocol steps, deepening questions, etc.) live in UI JSON files;
 * the server only needs enough to route and inject a terse protocol preamble.
 *
 * PlayId is the canonical union type — both sides must stay in sync.
 */

import type { PlayId } from '../types/advisor.js';

/** Plays that are safe to activate even when the user is dysregulated. */
const SAFE_DYSREGULATED = new Set<PlayId>([
  'somatic_pendulation',
  'ladder',
  'odyssey',
  'best_possible_self',
  'immunity',
  'fear_setting',
  'regret_min',
]);

interface PlayRoute {
  id: PlayId;
  signals: readonly string[];
}

/**
 * Ordered list of plays with their trigger signals.
 * somatic_pendulation is first so it wins when arousal is already elevated.
 */
const PLAY_ROUTES: readonly PlayRoute[] = [
  {
    id: 'somatic_pendulation',
    signals: ['overwhelmed', "can't think straight", 'flooding', 'spinning', 'too much', 'panicking', "can't calm down", 'heart racing', 'shutting down', 'frozen', 'shaking'],
  },
  {
    id: 'ifs_parts',
    signals: ['part of me', 'one side of me', 'something in me', 'I keep fighting myself', 'I know I should but another part', 'inner conflict', 'divided', 'tug of war inside'],
  },
  {
    id: 'focusing',
    signals: ['can feel it in my body', 'chest tight', 'knot in stomach', "something I can't name", 'gut feeling', "can't put it into words", "there's something there but", "this feeling I can't shake"],
  },
  {
    id: 'downward_arrow',
    signals: ['worried that', 'afraid that', 'fear that', 'what if', 'worst case', 'people will think', 'what would happen if'],
  },
  {
    id: 'immunity',
    signals: ['keep meaning to', 'should be doing', "can't seem to", 'always sabotage', 'why do I keep doing this', 'knowing and not doing', 'stuck in the same pattern', 'self-sabotage'],
  },
  {
    id: 'byron_katie',
    signals: ["shouldn't have", 'should be', "he doesn't", 'she never', "I'm a failure", "they don't care", "it's not fair", "why won't they", 'they should'],
  },
  {
    id: 'ladder',
    signals: ['what do I actually want', 'why do I want', 'what matters', 'what am I really after', 'why does this feel important', 'I should but'],
  },
  {
    id: 'best_possible_self',
    signals: ['lost motivation', "don't know why I'm doing this", "can't see the point", 'burned out', 'going through the motions', "what's the point", 'feel flat', 'no sense of purpose'],
  },
  {
    id: 'odyssey',
    signals: ["don't know what I want", 'stuck at a crossroads', 'multiple paths', 'life direction', 'career change', 'what should I do with my life', 'five years from now', 'alternate futures'],
  },
  {
    id: 'fear_setting',
    signals: ['what if it all goes wrong', 'terrified it will fail', 'lose everything', "can't stop imagining", 'paralysed by fear of failure', 'too scary to try'],
  },
  {
    id: 'regret_min',
    signals: ['should I leave', 'should I stay', 'big decision', "don't know which path", 'life-changing choice', 'opportunity I might regret', 'regret not trying', 'what if I look back'],
  },
];

/**
 * Protocol preamble injected into the coach system prompt when a play is routed.
 * Terse server-side summary — UI JSON files contain the full step-by-step text.
 */
const PLAY_PROTOCOL: Record<PlayId, string> = {
  somatic_pendulation: '[PLAY: Somatic Pendulation] The user is activated. Ask where they feel it in their body. Find a resource (somewhere that feels okay). Pendulate between activation and resource. Do NOT analyse or ask why. Do NOT rush to insight.',
  ladder: '[PLAY: Laddering] Ask "What would having that give you?" on each want. Continue until a terminal value is named. Reflect it back without elaborating. Do NOT supply the value yourself.',
  downward_arrow: '[PLAY: Downward Arrow] Take the feared outcome at face value. Ask "And if that happened, what would that mean?" Arrow downward — no reassurance, no problem-solving. Stop when the user reaches an absolute belief ("I am...", "I will never...").',
  odyssey: '[PLAY: Odyssey Planning] Map three 5-year scenarios: (1) current trajectory, (2) meaningful pivot, (3) wild-card. For each: title, a day in that life, confidence/excitement ratings. Find values common to all three.',
  best_possible_self: '[PLAY: Best Possible Self] Invite the user to imagine their best possible self 5–10 years from now. What are they doing, feeling, and becoming? Surface the gap between this self and their current trajectory. Do NOT critique the vision.',
  immunity: "[PLAY: Immunity to Change] Identify the user's improvement goal. Surface counter-behaviours (what they do instead). Uncover the hidden commitment those behaviours protect. Reveal the big assumption. Design a small, safe experiment to test the assumption.",
  focusing: "[PLAY: Focusing] Invite the user to bring attention to the unclear felt sense. Ask what it's like, not what it means. Wait for a felt shift (a physical change). Do NOT interpret or diagnose — the user's body leads.",
  ifs_parts: '[PLAY: IFS Parts] Help the user identify the part that is activated. Approach it with curiosity, not criticism: "What does this part want you to know?" Separate the part from the Self. Look for the positive intent underneath even the most troubling part.',
  byron_katie: '[PLAY: The Work / Byron Katie] Take the user\'s stressful thought. Apply four questions: Is it true? Can you absolutely know it\'s true? How do you react when you believe it? Who would you be without it? Find the turnaround. Do NOT argue with the thought.',
  fear_setting: '[PLAY: Fear Setting] Define the worst case explicitly. Estimate the probability. Plan what you would do if it happened. Now ask: what is the cost of inaction? Surface what the fear is protecting and what it is costing.',
  regret_min: '[PLAY: Regret Minimisation] Project the user to age 80 looking back. Which choice would they regret more? Surface what regret is made of in this case (unexplored potential, betrayed values, unexpressed love). What would the 80-year-old self say to act on?',
};

/**
 * Route a user message to a play, respecting the dysregulation gate.
 *
 * @param message   The user message (already sanitized)
 * @param dysregulated  Whether the state-gate returned 'ground' — only safe plays are eligible
 * @returns The matched PlayId, or null if no trigger matches
 */
export function routePlay(message: string, dysregulated: boolean): PlayId | null {
  const lower = message.toLowerCase();
  for (const { id, signals } of PLAY_ROUTES) {
    if (dysregulated && !SAFE_DYSREGULATED.has(id)) continue;
    if (signals.some(s => lower.includes(s.toLowerCase()))) {
      return id;
    }
  }
  return null;
}

/** Get the terse protocol injection string for a play. */
export function getPlayProtocol(id: PlayId): string {
  return PLAY_PROTOCOL[id];
}

/** Get the display label for a play (for play_active SSE frame). */
const PLAY_LABELS: Record<PlayId, string> = {
  ladder: 'Laddering',
  downward_arrow: 'Downward Arrow',
  odyssey: 'Odyssey Planning',
  best_possible_self: 'Best Possible Self',
  immunity: 'Immunity to Change',
  focusing: 'Focusing',
  somatic_pendulation: 'Somatic Pendulation',
  ifs_parts: 'IFS Parts',
  byron_katie: 'The Work',
  fear_setting: 'Fear Setting',
  regret_min: 'Regret Minimisation',
};

export function getPlayLabel(id: PlayId): string {
  return PLAY_LABELS[id];
}
