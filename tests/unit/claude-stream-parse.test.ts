/**
 * Unit tests for parseClaudeStreamLine — the pure line parser inside claude-stream.ts.
 *
 * These fixtures are REAL shapes captured from
 *   claude -p --output-format stream-json --verbose --include-partial-messages
 * The CLI wraps streaming events in a {type:'stream_event', event:{...}} envelope.
 * The previous parser checked for a TOP-LEVEL content_block_delta, which the CLI
 * never emits — so no text deltas were ever parsed (MCPAT-074). These tests pin the
 * real envelope shape so the regression cannot return.
 */
import { describe, it, expect } from 'vitest';
import { parseClaudeStreamLine } from '../../src/lib/claude-stream.js';

describe('parseClaudeStreamLine', () => {
  it('extracts text from a stream_event-wrapped content_block_delta (text_delta)', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'Hey there, friend.' },
      },
      session_id: '7d9f5e72',
    });
    expect(parseClaudeStreamLine(line)).toEqual({ type: 'delta', text: 'Hey there, friend.' });
  });

  it('ignores thinking_delta inside a stream_event envelope', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'The user wants' },
      },
    });
    expect(parseClaudeStreamLine(line)).toBeNull();
  });

  it('ignores signature_delta inside a stream_event envelope', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'abc' } },
    });
    expect(parseClaudeStreamLine(line)).toBeNull();
  });

  it('extracts session id from the top-level result event', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Hey there, friend.',
      session_id: 'sess-abc-123',
    });
    expect(parseClaudeStreamLine(line)).toEqual({ type: 'session', sessionId: 'sess-abc-123' });
  });

  it('ignores message_start / content_block_start / message_stop envelope events', () => {
    for (const inner of ['message_start', 'content_block_start', 'content_block_stop', 'message_delta', 'message_stop']) {
      const line = JSON.stringify({ type: 'stream_event', event: { type: inner } });
      expect(parseClaudeStreamLine(line)).toBeNull();
    }
  });

  it('ignores system / rate_limit_event lines', () => {
    expect(parseClaudeStreamLine(JSON.stringify({ type: 'system', subtype: 'init' }))).toBeNull();
    expect(parseClaudeStreamLine(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: {} }))).toBeNull();
  });

  it('returns null for blank lines and malformed JSON', () => {
    expect(parseClaudeStreamLine('')).toBeNull();
    expect(parseClaudeStreamLine('   ')).toBeNull();
    expect(parseClaudeStreamLine('{not json')).toBeNull();
  });

  it('still accepts a bare top-level content_block_delta (back-compat)', () => {
    const line = JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } });
    expect(parseClaudeStreamLine(line)).toEqual({ type: 'delta', text: 'hi' });
  });
});
