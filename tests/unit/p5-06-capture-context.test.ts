/**
 * P5-06 — capture context bias + roadmap-assign error toast.
 * quickCapture body is tested behaviorally (fetch-mocked); UI wiring via source inspection (no RTL).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { quickCapture } from '../../src/ui/src/api';

const uiSrc = path.join(process.cwd(), 'src', 'ui', 'src');
const readUi = (rel: string): string => fs.readFileSync(path.join(uiSrc, rel), 'utf-8');

function mockFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ taskId: 'GEN-001', project: 'GEN' }) });
  // @ts-expect-error test shim
  global.fetch = fn;
  return fn;
}

describe('P5-06 — capture context', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('AC1: quickCapture includes the context prefix string in the POST body', async () => {
    const fn = mockFetch();
    await quickCapture('do a thing', 'MCPAT');
    const body = JSON.parse(fn.mock.calls[0][1].body as string) as { text: string; context?: string };
    expect(body.text).toBe('do a thing');
    expect(body.context).toBe('MCPAT');
  });

  it('AC3: client preserves an explicit #PREFIX verbatim and still sends context (server resolves precedence)', async () => {
    const fn = mockFetch();
    await quickCapture('#MCPAT urgent note', 'COND');
    const body = JSON.parse(fn.mock.calls[0][1].body as string) as { text: string; context?: string };
    // the client must NOT strip/override the explicit prefix — it sends the text unchanged
    expect(body.text).toBe('#MCPAT urgent note');
    // context is still sent as a bias; the P4-06 backend honours #PREFIX over context
    expect(body.context).toBe('COND');
  });

  it('AC5: quickCapture omits context when none is supplied (graceful degradation)', async () => {
    const fn = mockFetch();
    await quickCapture('unscoped capture');
    const body = JSON.parse(fn.mock.calls[0][1].body as string) as { text: string; context?: string };
    expect('context' in body).toBe(false);
  });

  it('AC1/AC2: CaptureOverlay threads the active project; App derives a single selected project', () => {
    expect(readUi('components/CaptureOverlay.tsx')).toMatch(/quickCapture\(t, activeProject\)/);
    expect(readUi('App.tsx')).toMatch(/activeProject=\{filter\.projects\.length === 1/);
  });

  it('AC4: RoadmapView surfaces a visible error on a failed milestone-assign', () => {
    const src = readUi('views/RoadmapView.tsx');
    expect(src).toContain('assignError');
    expect(src).toContain('setAssignError');
    expect(src).toMatch(/role="alert"/);
  });
});
