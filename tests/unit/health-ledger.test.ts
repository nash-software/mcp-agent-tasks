import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendHealthEvent, HEALTH_SOURCE } from '../../src/health/health-ledger.js';
import type { HealthEventKind } from '../../src/health/health-ledger.js';

describe('health-ledger appendHealthEvent', () => {
  let tmpDir: string;
  let originalHealthDir: string | undefined;
  let ledgerPath: string;

  beforeEach(() => {
    originalHealthDir = process.env.CLAUDE_HEALTH_DIR;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-ledger-'));
    process.env.CLAUDE_HEALTH_DIR = tmpDir;
    ledgerPath = path.join(tmpDir, 'health.jsonl');
  });

  afterEach(() => {
    if (originalHealthDir === undefined) {
      delete process.env.CLAUDE_HEALTH_DIR;
    } else {
      process.env.CLAUDE_HEALTH_DIR = originalHealthDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips an appended heartbeat as parseable JSON with all five fields', () => {
    appendHealthEvent({ source: HEALTH_SOURCE, kind: 'heartbeat', detail: { event: 'startup' }, session: 'sess-1' });

    const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const ev = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(Object.keys(ev).sort()).toEqual(['detail', 'kind', 'session', 'source', 'ts']);
    expect(ev.source).toBe(HEALTH_SOURCE);
    expect(ev.kind).toBe('heartbeat');
    expect(ev.detail).toEqual({ event: 'startup' });
    expect(ev.session).toBe('sess-1');
    expect(typeof ev.ts).toBe('string');
    expect(Number.isFinite(Date.parse(ev.ts as string))).toBe(true);
  });

  it('defaults detail to {} and session to null when omitted', () => {
    appendHealthEvent({ source: HEALTH_SOURCE, kind: 'status' });

    const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
    const ev = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(ev.detail).toEqual({});
    expect(ev.session).toBeNull();
  });

  it('writes nothing for an invalid kind', () => {
    appendHealthEvent({ source: HEALTH_SOURCE, kind: 'not-a-kind' as HealthEventKind });

    expect(fs.existsSync(ledgerPath)).toBe(false);
  });

  it('appends two lines for two events', () => {
    appendHealthEvent({ source: HEALTH_SOURCE, kind: 'heartbeat' });
    appendHealthEvent({ source: HEALTH_SOURCE, kind: 'metric', detail: { n: 1 } });

    const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it('does not throw when the state dir is a deeply nested non-existent path', () => {
    process.env.CLAUDE_HEALTH_DIR = path.join(tmpDir, 'a', 'b', 'c', 'd');

    expect(() => appendHealthEvent({ source: HEALTH_SOURCE, kind: 'error', detail: { message: 'boom' } })).not.toThrow();

    const nested = path.join(process.env.CLAUDE_HEALTH_DIR, 'health.jsonl');
    expect(fs.existsSync(nested)).toBe(true);
  });
});
