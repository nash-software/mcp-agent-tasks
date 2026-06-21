/**
 * Invariant tests for advisor-artifacts append-only versions[].
 * Verify command: CLAUDE_CLI_DISABLED=1 npx vitest run --reporter=verbose advisor-artifacts-versions
 *
 * Key invariant (spec §12.5): Artifacts versions are append-only.
 * appendVersion() must NEVER overwrite or remove existing versions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {
  createArtifact,
  appendVersion,
  getArtifact,
  listArtifacts,
} from '../../src/store/advisor-artifacts.js';
import type { Artifact } from '../../src/types/advisor.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-artifacts-test-'));
  process.env['MCP_TASKS_DIR'] = tempDir;
});

// ── Append-only invariant ─────────────────────────────────────────────────

describe('artifacts versions — append-only invariant', () => {
  it('createArtifact stores first version in versions[0]', async () => {
    const now = '2026-06-22T00:00:00Z';
    const art: Artifact = {
      id: 'art-1',
      kind: 'odyssey_plan',
      title: 'My Odyssey',
      created_at: now,
      updated_at: now,
      versions: [{ ts: now, body: 'Draft 1 content' }],
      linked_entities: [],
    };
    await createArtifact(art);

    const retrieved = await getArtifact('art-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.versions).toHaveLength(1);
    expect(retrieved!.versions[0].body).toBe('Draft 1 content');
  });

  it('appendVersion grows versions[] — never overwrites', async () => {
    const now = '2026-06-22T00:00:00Z';
    await createArtifact({
      id: 'art-2',
      kind: 'immunity_map',
      title: 'My Immunity Map',
      created_at: now,
      updated_at: now,
      versions: [{ ts: now, body: 'Version 1' }],
      linked_entities: [],
    });

    await appendVersion('art-2', { ts: '2026-06-22T01:00:00Z', body: 'Version 2' });
    await appendVersion('art-2', { ts: '2026-06-22T02:00:00Z', body: 'Version 3' });

    const art = await getArtifact('art-2');
    expect(art!.versions).toHaveLength(3);
    // All versions preserved in order
    expect(art!.versions[0].body).toBe('Version 1');
    expect(art!.versions[1].body).toBe('Version 2');
    expect(art!.versions[2].body).toBe('Version 3');
  });

  it('prior versions survive after appendVersion', async () => {
    const now = '2026-06-22T00:00:00Z';
    await createArtifact({
      id: 'art-3',
      kind: 'belief_ledger',
      title: 'Belief Ledger',
      created_at: now,
      updated_at: now,
      versions: [{ ts: now, body: 'Original content' }],
      linked_entities: [],
    });

    // Append many versions
    for (let i = 2; i <= 5; i++) {
      await appendVersion('art-3', { ts: `2026-06-22T0${i}:00:00Z`, body: `Version ${i}` });
    }

    const art = await getArtifact('art-3');
    // Original version at index 0 is untouched
    expect(art!.versions[0].body).toBe('Original content');
    expect(art!.versions).toHaveLength(5);
  });

  it('appendVersion throws for unknown artifact id', async () => {
    await expect(
      appendVersion('nonexistent', { ts: '2026-06-22T00:00:00Z', body: 'test' }),
    ).rejects.toThrow();
  });

  it('createArtifact throws if id already exists', async () => {
    const now = '2026-06-22T00:00:00Z';
    const art: Artifact = {
      id: 'art-dup',
      kind: 'fear_map',
      title: 'Fear Map',
      created_at: now,
      updated_at: now,
      versions: [{ ts: now, body: 'v1' }],
      linked_entities: [],
    };
    await createArtifact(art);
    await expect(createArtifact(art)).rejects.toThrow();
  });
});

// ── listArtifacts filtering ────────────────────────────────────────────────

describe('listArtifacts', () => {
  it('returns all artifacts when no kind filter', async () => {
    const now = '2026-06-22T00:00:00Z';
    await createArtifact({ id: 'a1', kind: 'odyssey_plan', title: 'A1', created_at: now, updated_at: now, versions: [{ ts: now, body: 'x' }], linked_entities: [] });
    await createArtifact({ id: 'a2', kind: 'immunity_map', title: 'A2', created_at: now, updated_at: now, versions: [{ ts: now, body: 'y' }], linked_entities: [] });

    const all = await listArtifacts();
    expect(all).toHaveLength(2);
  });

  it('filters by kind when specified', async () => {
    const now = '2026-06-22T00:00:00Z';
    await createArtifact({ id: 'b1', kind: 'odyssey_plan', title: 'B1', created_at: now, updated_at: now, versions: [{ ts: now, body: 'x' }], linked_entities: [] });
    await createArtifact({ id: 'b2', kind: 'values_charter', title: 'B2', created_at: now, updated_at: now, versions: [{ ts: now, body: 'y' }], linked_entities: [] });

    const filtered = await listArtifacts('odyssey_plan');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('b1');
  });

  it('returns [] for empty store', async () => {
    const artifacts = await listArtifacts();
    expect(artifacts).toHaveLength(0);
  });
});
