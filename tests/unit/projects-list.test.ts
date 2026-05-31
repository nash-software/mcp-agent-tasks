/**
 * Behavioral tests for buildProjectsList — the pure assembler behind GET /api/projects (P5-09 AC3).
 */
import { describe, it, expect } from 'vitest';
import { buildProjectsList } from '../../src/projects-list.js';

describe('buildProjectsList', () => {
  const config = [
    { prefix: 'ACT', path: '/p/act' },
    { prefix: 'SEC', path: '/p/sec' },
  ];

  it('appends the global GEN project when a GEN tasks dir is provided', () => {
    const out = buildProjectsList(config, '/home/.mcp-tasks/tasks/gen');
    expect(out.map(p => p.prefix)).toEqual(['ACT', 'SEC', 'GEN']);
    expect(out.find(p => p.prefix === 'GEN')?.path).toBe('/home/.mcp-tasks/tasks/gen');
    expect(out.find(p => p.prefix === 'GEN')?.name).toBe('GEN');
  });

  it('omits GEN when no GEN tasks dir exists', () => {
    const out = buildProjectsList(config, null);
    expect(out.map(p => p.prefix)).toEqual(['ACT', 'SEC']);
  });

  it('does not duplicate GEN when it is already a configured project', () => {
    const withGen = [...config, { prefix: 'GEN', path: '/p/gen-configured' }];
    const out = buildProjectsList(withGen, '/home/.mcp-tasks/tasks/gen');
    expect(out.filter(p => p.prefix === 'GEN')).toHaveLength(1);
    // the configured entry wins (not overwritten by the auto-append)
    expect(out.find(p => p.prefix === 'GEN')?.path).toBe('/p/gen-configured');
  });

  it('falls back name to prefix when unset (uniform API contract — AC1)', () => {
    const out = buildProjectsList([{ prefix: 'X', path: '/x' }], null);
    expect(out).toEqual([{ prefix: 'X', name: 'X', path: '/x' }]);
  });

  it('passes the optional name through when present (MCPAT-063)', () => {
    const out = buildProjectsList([{ prefix: 'ACR', name: 'Agent Control Room', path: '/p/acr' }], null);
    expect(out).toEqual([{ prefix: 'ACR', name: 'Agent Control Room', path: '/p/acr' }]);
  });

  it('always includes a name key (name === prefix signals "no friendly name")', () => {
    const out = buildProjectsList([{ prefix: 'Y', path: '/y' }], null);
    expect(out[0].name).toBe('Y');
  });
});
