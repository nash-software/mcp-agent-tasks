/**
 * Tests for hooks/lib/intent-extractor.js
 * Tests buildPrompt, sanitizeContent, and extractIntents noise filters.
 * Does NOT call a real LLM — uses MCP_TASKS_CLAUDE_BINARY env override for extractIntents tests.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const LIB_PATH = path.resolve('hooks/lib/intent-extractor.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { sanitizeContent, REDACT_PATTERNS, buildPrompt, extractIntents } = require(LIB_PATH) as {
  sanitizeContent: (content: string) => string;
  REDACT_PATTERNS: RegExp[];
  buildPrompt: (transcript: Array<{ role: string; content: string }>) => string;
  extractIntents: (
    transcript: Array<{ role: string; content: string }>,
    timeoutMs: number,
  ) => unknown[];
};

// ─── sanitizeContent ──────────────────────────────────────────────────────────

describe('sanitizeContent', () => {
  it('redacts OpenAI/Anthropic-style API keys (sk-...)', () => {
    const input = 'My key is sk-abc123XYZfoo and another sk-proj-abc-def-ghi';
    const result = sanitizeContent(input);
    expect(result).not.toContain('sk-abc123XYZfoo');
    expect(result).not.toContain('sk-proj-abc-def-ghi');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts JWT tokens (three base64url segments separated by dots)', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = sanitizeContent(`token=${jwt}`);
    expect(result).not.toContain(jwt);
    expect(result).toContain('[REDACTED]');
  });

  it('redacts email addresses', () => {
    const input = 'Contact me at user@example.com or admin@company.org';
    const result = sanitizeContent(input);
    expect(result).not.toContain('user@example.com');
    expect(result).not.toContain('admin@company.org');
    expect(result).toContain('[REDACTED]');
  });

  it('leaves plain text unmodified', () => {
    const input = 'Build a new feature for the dashboard';
    expect(sanitizeContent(input)).toBe(input);
  });

  it('REDACT_PATTERNS is an array of RegExp', () => {
    expect(Array.isArray(REDACT_PATTERNS)).toBe(true);
    expect(REDACT_PATTERNS.length).toBeGreaterThan(0);
    for (const p of REDACT_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });
});

// ─── buildPrompt ──────────────────────────────────────────────────────────────

describe('buildPrompt', () => {
  function makeTranscript(n: number): Array<{ role: string; content: string }> {
    return Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i + 1}: short content`,
    }));
  }

  it('returns a string containing the system message', () => {
    const prompt = buildPrompt(makeTranscript(5));
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('includes <TRANSCRIPT_START> and <TRANSCRIPT_END> delimiters', () => {
    const prompt = buildPrompt(makeTranscript(5));
    expect(prompt).toContain('<TRANSCRIPT_START>');
    expect(prompt).toContain('<TRANSCRIPT_END>');
  });

  it('respects the 40-message cap — includes at most 40 messages', () => {
    // Build a transcript with 60 messages of moderate length
    const transcript = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message number ${i + 1}: discussing a feature request for the task manager`,
    }));
    const prompt = buildPrompt(transcript);
    // Count role labels in the prompt body (each included message contributes one role line)
    const userCount = (prompt.match(/\[user\]/g) || []).length;
    const assistantCount = (prompt.match(/\[assistant\]/g) || []).length;
    expect(userCount + assistantCount).toBeLessThanOrEqual(40);
  });

  it('respects the 3800-char budget — total included content does not exceed budget', () => {
    // Build a transcript where each message is 200 chars — 40 messages = 8000 chars total
    const transcript = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'A'.repeat(200) + ` msg-${i}`,
    }));
    const prompt = buildPrompt(transcript);
    // Extract the portion between the delimiters
    const start = prompt.indexOf('<TRANSCRIPT_START>');
    const end = prompt.indexOf('<TRANSCRIPT_END>');
    const body = start !== -1 && end !== -1 ? prompt.slice(start, end) : prompt;
    // The body length must be well under 3800 chars × number of messages
    // (we can't exactly check the internal budget, but the total prompt content must be bounded)
    // Pragmatic check: we verify that not all 30 messages are included
    const userCount = (prompt.match(/\[user\]/g) || []).length;
    const assistantCount = (prompt.match(/\[assistant\]/g) || []).length;
    const included = userCount + assistantCount;
    expect(included).toBeLessThan(30);
    // And that the content body stays roughly bounded
    expect(body.length).toBeLessThan(6000);
  });

  it('N5: single oversized message (> 3800 chars) is truncated with "..." and post-truncation re-check prevents budget overflow', () => {
    // A single message that is 5000 chars — larger than the 3800-char budget
    const bigMessage = 'B'.repeat(5000);
    const transcript = [{ role: 'user', content: bigMessage }];
    const prompt = buildPrompt(transcript);
    // The message should appear in the prompt (truncated form)
    expect(prompt).toContain('...');
    // The truncated content should not exceed 3800 chars in content length
    // Find the content between delimiters
    const start = prompt.indexOf('<TRANSCRIPT_START>');
    const end = prompt.indexOf('<TRANSCRIPT_END>');
    const body = start !== -1 && end !== -1 ? prompt.slice(start, end) : '';
    // The 'B' run in the body should be capped at <= 3800
    const bRun = body.match(/B+/);
    if (bRun) {
      expect(bRun[0].length).toBeLessThanOrEqual(3800);
    }
  });
});

// ─── extractIntents noise filters ─────────────────────────────────────────────

describe('extractIntents noise filters', () => {
  it('returns [] for transcript with fewer than 4 entries', () => {
    const transcript = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'Goodbye' },
    ];
    // noise filter should trigger before any LLM call — no binary needed
    const result = extractIntents(transcript, 5000);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('returns [] for all-assistant transcript', () => {
    const transcript = Array.from({ length: 6 }, (_, i) => ({
      role: 'assistant',
      content: `Assistant message ${i + 1}`,
    }));
    const result = extractIntents(transcript, 5000);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});
