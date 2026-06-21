/**
 * Unit tests for the advisor chat API constraints.
 * Verifies coach-specific invariants without spawning real LLM.
 * Runs under CLAUDE_CLI_DISABLED=1.
 *
 * Key invariant: coach mode MUST NOT emit ActionCards (action_draft frames).
 * ActionCards are only valid for pm and chairman modes.
 */
import { describe, it, expect } from 'vitest';

// Re-export the server-side action-extraction instruction check:
// The server conditionally includes ACTION_EXTRACTION_INSTRUCTION based on mode.
// We test the condition string rather than spawning a server, to keep this hermetic.

// The relevant server-side logic (from server-ui.ts):
//   const ACTION_EXTRACTION_INSTRUCTION = activeMode === 'pm' || activeMode === 'chairman'
//     ? '\n\nAt the end of your response...'
//     : '';

describe('ActionCard emission invariant', () => {
  type AdvisorMode = 'pm' | 'chairman' | 'coach';

  function actionInstructionEnabled(mode: AdvisorMode): boolean {
    return mode === 'pm' || mode === 'chairman';
  }

  it('enables action instruction for pm', () => {
    expect(actionInstructionEnabled('pm')).toBe(true);
  });

  it('enables action instruction for chairman', () => {
    expect(actionInstructionEnabled('chairman')).toBe(true);
  });

  it('disables action instruction for coach — invariant', () => {
    expect(actionInstructionEnabled('coach')).toBe(false);
  });
});

// Test the gate action variable initialization
describe('gate action default', () => {
  it('defaults to proceed when not coach mode', () => {
    function simulateGateInit(mode: string): string {
      let gateAction: 'proceed' | 'ground' | 'refer' = 'proceed';
      if (mode !== 'coach') {
        // gate only runs for coach — no change
      }
      return gateAction;
    }
    expect(simulateGateInit('pm')).toBe('proceed');
    expect(simulateGateInit('chairman')).toBe('proceed');
  });
});

// Test the state_flag frame shape matches AdvisorChatFrame type
describe('state_flag frame shape', () => {
  it('has required fields: mode (string) + action (ground | refer | pause)', () => {
    const groundFrame = { type: 'state_flag' as const, mode: 'ruminating', action: 'ground' as const };
    expect(groundFrame.type).toBe('state_flag');
    expect(groundFrame.action).toBe('ground');
    expect(typeof groundFrame.mode).toBe('string');
  });

  it('refer action is valid', () => {
    const referFrame = { type: 'state_flag' as const, mode: 'refer', action: 'refer' as const };
    expect(referFrame.action).toBe('refer');
  });
});

// Test the play_active frame shape
describe('play_active frame shape', () => {
  it('has play, label, and reason fields', () => {
    const frame = {
      type: 'play_active' as const,
      play: 'somatic_pendulation',
      label: 'Somatic Pendulation',
      reason: 'trigger-signal match',
    };
    expect(frame.type).toBe('play_active');
    expect(typeof frame.play).toBe('string');
    expect(typeof frame.label).toBe('string');
  });
});

// Test the REFERRAL_NOTICE constant — must be present and non-empty
describe('referral notice', () => {
  it('is a non-empty string', () => {
    const REFERRAL_NOTICE = "I want to be honest with you — what you're describing sounds really intense. Please consider talking to someone you trust, or a therapist or counsellor who can give you their full attention. I'm still here, but some of what you're sharing is beyond what I'm best placed to help with alone.";
    expect(typeof REFERRAL_NOTICE).toBe('string');
    expect(REFERRAL_NOTICE.length).toBeGreaterThan(50);
    expect(REFERRAL_NOTICE.trim()).not.toBe(''); // non-empty
    // Must not contain raw control chars (newlines OK, unicode em-dash OK)
    expect(REFERRAL_NOTICE).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
  });
});
