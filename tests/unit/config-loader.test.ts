import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveServerDbPath } from '../../src/config/loader.js';

describe('resolveServerDbPath', () => {
  it('uses .index.db inside tasksDir when tasksDir exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-loader-test-'));
    try {
      expect(resolveServerDbPath(dir)).toBe(path.join(dir, '.index.db'));
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('falls back to global tasks.db when tasksDir does not exist', () => {
    const missing = path.join(os.tmpdir(), `mcp-nonexistent-${Date.now()}`);
    const result = resolveServerDbPath(missing);
    expect(result).toMatch(/tasks\.db$/);
    expect(result).not.toContain('.index.db');
  });
});
