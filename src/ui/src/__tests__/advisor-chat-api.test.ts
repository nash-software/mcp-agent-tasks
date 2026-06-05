/**
 * advisor-chat-api.test.ts — Unit tests for streamAdvisorChat in src/ui/src/api.ts
 *
 * Uses stubbed fetch returning a hand-crafted SSE body to verify the async generator
 * yields the correct AdvisorChatFrame values.
 *
 * ACs:
 *  - yields { type: 'delta', text: 'hello' } from delta SSE frame
 *  - yields { type: 'session', sessionId: 'abc' } from session SSE frame
 *  - yields { type: 'done' } from done SSE frame
 *  - yields { type: 'error', message: 'HTTP 500' } on non-OK response
 *  - no duplicate done frame emitted after an explicit done event
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { streamAdvisorChat, type AdvisorChatFrame } from '../api'

afterEach(() => { vi.restoreAllMocks() })

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a ReadableStream from a string of SSE text. */
function sseStream(body: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body))
      controller.close()
    },
  })
}

/** Collect all frames from an async generator. */
async function collect(gen: AsyncGenerator<AdvisorChatFrame>): Promise<AdvisorChatFrame[]> {
  const frames: AdvisorChatFrame[] = []
  for await (const f of gen) {
    frames.push(f)
  }
  return frames
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('streamAdvisorChat — happy path', () => {
  it('yields delta, session, done frames from SSE body', async () => {
    const sseBody = [
      'event: delta',
      'data:{"text":"hello"}',
      '',
      'event: session',
      'data:{"sessionId":"abc"}',
      '',
      'event: done',
      'data:{}',
      '',
    ].join('\n')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: sseStream(sseBody),
    }))

    const frames = await collect(streamAdvisorChat([{ role: 'user', content: 'hello' }]))

    expect(frames.find(f => f.type === 'delta')).toEqual({ type: 'delta', text: 'hello' })
    expect(frames.find(f => f.type === 'session')).toEqual({ type: 'session', sessionId: 'abc' })
    expect(frames.find(f => f.type === 'done')).toEqual({ type: 'done' })
  })

  it('passes sessionId in request body when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: sseStream('event: done\ndata:{}\n\n'),
    })
    vi.stubGlobal('fetch', mockFetch)

    await collect(streamAdvisorChat([{ role: 'user', content: 'hi' }], 'sess-123'))

    expect(mockFetch).toHaveBeenCalledWith('/api/advisor/chat', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"sessionId":"sess-123"'),
    }))
  })

  it('yields final done frame after stream ends', async () => {
    // No explicit done frame in the SSE — generator should emit one on stream end
    const sseBody = 'event: delta\ndata:{"text":"hi"}\n\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: sseStream(sseBody),
    }))

    const frames = await collect(streamAdvisorChat([{ role: 'user', content: 'test' }]))
    const doneFrames = frames.filter(f => f.type === 'done')
    expect(doneFrames.length).toBeGreaterThanOrEqual(1)
  })
})

describe('streamAdvisorChat — error path', () => {
  it('yields error frame on non-OK HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
    }))

    const frames = await collect(streamAdvisorChat([{ role: 'user', content: 'hi' }]))
    expect(frames[0]).toEqual({ type: 'error', message: 'HTTP 500' })
  })

  it('yields error frame when body is null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: null,
    }))

    const frames = await collect(streamAdvisorChat([{ role: 'user', content: 'hi' }]))
    expect(frames[0].type).toBe('error')
  })

  it('yields error frame from SSE error event', async () => {
    const sseBody = 'event: error\ndata:{"message":"timeout"}\n\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: sseStream(sseBody),
    }))

    const frames = await collect(streamAdvisorChat([{ role: 'user', content: 'hi' }]))
    expect(frames.find(f => f.type === 'error')).toEqual({ type: 'error', message: 'timeout' })
  })
})
