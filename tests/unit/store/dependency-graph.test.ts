import { describe, it, expect } from 'vitest';
import { detectCycle } from '../../../src/store/dependency-graph.js';

describe('detectCycle()', () => {
  it('no cycle: linear A→B, add C→B: no cycle', () => {
    const edges: Array<[string, string]> = [['A', 'B']];
    expect(detectCycle(edges, ['C', 'B'])).toBe(false);
  });

  it('no cycle: empty graph, add A→B: no cycle', () => {
    expect(detectCycle([], ['A', 'B'])).toBe(false);
  });

  it('no cycle: A→B, C→B — add D→A: no cycle', () => {
    const edges: Array<[string, string]> = [
      ['A', 'B'],
      ['C', 'B'],
    ];
    expect(detectCycle(edges, ['D', 'A'])).toBe(false);
  });

  it('direct cycle: A→B, add B→A: cycle detected', () => {
    const edges: Array<[string, string]> = [['A', 'B']];
    expect(detectCycle(edges, ['B', 'A'])).toBe(true);
  });

  it('self-loop: add A→A: cycle detected', () => {
    expect(detectCycle([], ['A', 'A'])).toBe(true);
  });

  it('transitive cycle: A→B, B→C, add C→A: cycle detected', () => {
    const edges: Array<[string, string]> = [
      ['A', 'B'],
      ['B', 'C'],
    ];
    expect(detectCycle(edges, ['C', 'A'])).toBe(true);
  });

  it('longer transitive cycle: A→B, B→C, C→D, add D→A: cycle', () => {
    const edges: Array<[string, string]> = [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
    ];
    expect(detectCycle(edges, ['D', 'A'])).toBe(true);
  });

  it('unrelated chain does not create false positive', () => {
    // X→Y→Z is independent from A→B
    const edges: Array<[string, string]> = [
      ['A', 'B'],
      ['X', 'Y'],
      ['Y', 'Z'],
    ];
    expect(detectCycle(edges, ['A', 'X'])).toBe(false);
  });

  it('diamond dependency: A→B, A→C, B→D, C→D — add D→A: cycle', () => {
    const edges: Array<[string, string]> = [
      ['A', 'B'],
      ['A', 'C'],
      ['B', 'D'],
      ['C', 'D'],
    ];
    expect(detectCycle(edges, ['D', 'A'])).toBe(true);
  });

  it('diamond dependency: A→B, A→C, B→D, C→D — add E→D: no cycle', () => {
    const edges: Array<[string, string]> = [
      ['A', 'B'],
      ['A', 'C'],
      ['B', 'D'],
      ['C', 'D'],
    ];
    expect(detectCycle(edges, ['E', 'D'])).toBe(false);
  });
});
