import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveServerDbPath, loadConfig } from '../../src/config/loader.js';

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

describe('loadConfig() cwd-independence', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, val] of Object.entries(originalEnv)) {
      process.env[key] = val;
    }
  });

  it('ignores <cwd>/.mcp-tasks.json when global config exists', () => {
    // Place a .mcp-tasks.json in the current working directory with a distinct storageDir.
    // After step 1, loadConfig() must NOT read this file — the global config takes precedence.
    const cwd = process.cwd();
    const localConfigPath = path.join(cwd, '.mcp-tasks.json');
    const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-global-test-'));
    const localAlreadyExists = fs.existsSync(localConfigPath);

    try {
      const localStorageDir = path.join(cwd, 'local-storage-sentinel');
      const globalStorageDir = path.join(globalDir, 'global-storage');

      if (!localAlreadyExists) {
        const localConfig = {
          version: 1,
          storageDir: localStorageDir,
          defaultStorage: 'local',
          enforcement: 'warn',
          autoCommit: false,
          claimTtlHours: 4,
          trackManifest: true,
          tasksDirName: 'agent-tasks',
          projects: [],
        };
        fs.writeFileSync(localConfigPath, JSON.stringify(localConfig), 'utf-8');
      }

      const globalConfig = {
        version: 1,
        storageDir: globalStorageDir,
        defaultStorage: 'global',
        enforcement: 'warn',
        autoCommit: false,
        claimTtlHours: 4,
        trackManifest: true,
        tasksDirName: 'agent-tasks',
        projects: [],
      };
      const globalConfigPath = path.join(globalDir, 'config.json');
      fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig), 'utf-8');

      // Point MCP_TASKS_CONFIG to the global config (step 1 of resolution chain)
      // so we can assert that the local cwd file is never consulted.
      process.env['MCP_TASKS_CONFIG'] = globalConfigPath;
      // Unset MCP_TASKS_DIR so it doesn't override storageDir
      delete process.env['MCP_TASKS_DIR'];

      const result = loadConfig();

      // Must use global storageDir, not the local-storage-sentinel
      expect(result.storageDir).toBe(globalStorageDir);
      expect(result.storageDir).not.toBe(localStorageDir);
    } finally {
      // Clean up only the local file if we created it
      if (!localAlreadyExists && fs.existsSync(localConfigPath)) {
        fs.unlinkSync(localConfigPath);
      }
      fs.rmSync(globalDir, { recursive: true });
    }
  });
});
