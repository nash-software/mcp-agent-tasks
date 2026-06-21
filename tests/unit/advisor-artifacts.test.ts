/**
 * Unit tests for src/store/advisor-artifacts.ts (T0.5)
 * Key invariant: versions[] is append-only — appendVersion never overwrites.
 * Runs under CLAUDE_CLI_DISABLED=1 — no LLM calls.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {
  listArtifacts,
  getArtifact,
  createArtifact,
  appendVersion,
} from '../../src/store/advisor-artifacts.js';
import type { Artifact } from '../../src/types/advisor.js';

beforeEach(() => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-test-'));
  process.env['MCP_TASKS_DIR'] = tempDir;
});

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'art-1',
    kind: 'odyssey_plan',
    title: 'My Odyssey Plan',
    created_at: '2026-06-21T10:00:00.000Z',
    updated_at: '2026-06-21T10:00:00.000Z',
    versions: [{ ts: '2026-06-21T10:00:00.000Z', body: 'Version 1 body' }],
    linked_entities: [],
    ...overrides,
  };
}

describe('listArtifacts', () => {
  it('returns [] initially', async () => {
    expect(await listArtifacts()).toEqual([]);
  });

  it('lists all artifacts when no kind filter', async () => {
    await createArtifact(artifact({ id: 'art-1', kind: 'odyssey_plan' }));
    await createArtifact(artifact({ id: 'art-2', kind: 'immunity_map' }));
    expect(await listArtifacts()).toHaveLength(2);
  });

  it('filters by kind', async () => {
    await createArtifact(artifact({ id: 'art-1', kind: 'odyssey_plan' }));
    await createArtifact(artifact({ id: 'art-2', kind: 'immunity_map' }));
    expect(await listArtifacts('odyssey_plan')).toHaveLength(1);
    expect(await listArtifacts('values_charter')).toHaveLength(0);
  });
});

describe('getArtifact', () => {
  it('returns artifact by id', async () => {
    const a = artifact();
    await createArtifact(a);
    expect(await getArtifact('art-1')).toEqual(a);
  });

  it('returns null for unknown id', async () => {
    expect(await getArtifact('no-such-artifact')).toBeNull();
  });
});

describe('createArtifact', () => {
  it('throws when id already exists', async () => {
    await createArtifact(artifact());
    await expect(createArtifact(artifact())).rejects.toThrow('already exists');
  });
});

describe('appendVersion — append-only invariant', () => {
  it('appends a new version without overwriting existing versions', async () => {
    const a = artifact({ versions: [{ ts: '2026-06-21T10:00:00.000Z', body: 'Version 1' }] });
    await createArtifact(a);

    await appendVersion('art-1', { ts: '2026-06-22T10:00:00.000Z', body: 'Version 2' });

    const updated = await getArtifact('art-1');
    expect(updated?.versions).toHaveLength(2);
    expect(updated?.versions[0]?.body).toBe('Version 1');
    expect(updated?.versions[1]?.body).toBe('Version 2');
  });

  it('accumulates multiple versions preserving all prior versions', async () => {
    await createArtifact(artifact());
    await appendVersion('art-1', { ts: '2026-06-22T10:00:00.000Z', body: 'V2' });
    await appendVersion('art-1', { ts: '2026-06-23T10:00:00.000Z', body: 'V3' });

    const art = await getArtifact('art-1');
    expect(art?.versions).toHaveLength(3);
    expect(art?.versions.map(v => v.body)).toEqual(['Version 1 body', 'V2', 'V3']);
  });

  it('updates updated_at to the new version ts', async () => {
    await createArtifact(artifact());
    await appendVersion('art-1', { ts: '2026-06-25T00:00:00.000Z', body: 'V2' });
    const art = await getArtifact('art-1');
    expect(art?.updated_at).toBe('2026-06-25T00:00:00.000Z');
  });

  it('throws when artifact not found', async () => {
    await expect(appendVersion('no-such', { ts: '2026-06-21T00:00:00.000Z', body: 'x' }))
      .rejects.toThrow('not found');
  });
});
