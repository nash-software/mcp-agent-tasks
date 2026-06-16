/**
 * claude-stream.ts — Async iterable wrapper around a streaming claude CLI spawn.
 *
 * Critical correctness requirements (Windows compatibility):
 *  - Spawn native .exe by full path. NEVER spawn .cmd (EINVAL on Node 18+) or bare
 *    'claude' (ENOENT when npm bin dir is not on PATH). Callers pass a resolved bin path.
 *  - shell: false — required to avoid EINVAL on Windows .cmd shim guard.
 *  - Env hygiene: delete (never set to undefined) the six Claude Code env vars that
 *    interfere with the CLI when spawned from within Claude Code.
 *  - Optional --model flag when caller provides a model ID; omit to let the CLI default.
 *  - Kill child on generator return/throw (req.close cleanup) and on timeout.
 *  - settled guard: skip post-close processing once settled.
 */

import { spawn } from 'node:child_process';

// ── Frame types ────────────────────────────────────────────────────────────

export type StreamFrame =
  | { type: 'delta'; text: string }
  | { type: 'session'; sessionId: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

// ── Raw stream-json types (parsed from claude stdout) ──────────────────────

/**
 * The CLI's `--include-partial-messages` mode wraps streaming Anthropic API events
 * in a `stream_event` envelope: {type:'stream_event', event:{type:'content_block_delta',…}}.
 * The text we want lives at event.delta.text (delta.type === 'text_delta'). Top-level
 * `result` carries the session_id. Anything else (thinking/signature deltas, message_*,
 * system, rate_limit_event) is ignored.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Parse a single stream-json line into a StreamFrame, or null if the line carries
 * nothing we surface. Pure + side-effect free so it is unit-testable without a spawn.
 * Handles both the `stream_event` envelope (real CLI output) and a bare top-level
 * `content_block_delta` (back-compat / older CLIs).
 */
export function parseClaudeStreamLine(line: string): StreamFrame | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let ev: unknown;
  try { ev = JSON.parse(trimmed); } catch { return null; }
  if (!isRecord(ev)) return null;

  // Unwrap the stream_event envelope; fall back to the event itself for bare deltas.
  const inner: unknown = ev['type'] === 'stream_event' && isRecord(ev['event']) ? ev['event'] : ev;
  if (isRecord(inner) && inner['type'] === 'content_block_delta') {
    const delta = inner['delta'];
    if (isRecord(delta) && delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
      return { type: 'delta', text: delta['text'] };
    }
    return null; // thinking_delta / signature_delta / empty
  }

  // session id arrives on the top-level result event
  if (ev['type'] === 'result' && typeof ev['session_id'] === 'string') {
    return { type: 'session', sessionId: ev['session_id'] };
  }

  return null;
}

// ── spawnClaudeStream ──────────────────────────────────────────────────────

export interface SpawnClaudeStreamOpts {
  bin: string;
  prompt: string;
  sessionId?: string;
  timeoutMs?: number;
  model?: string;
}

/**
 * Spawn a claude CLI process in streaming JSON mode and yield parsed StreamFrame values.
 * Env hygiene: the six Claude Code env vars are deleted from the spawned process environment
 * (delete, never set to undefined — undefined causes EINVAL on Windows).
 * Optional --model flag when caller provides a model ID; omit to let the CLI pick its default.
 */
export async function* spawnClaudeStream(
  opts: SpawnClaudeStreamOpts,
): AsyncGenerator<StreamFrame> {
  const { bin, prompt, sessionId, timeoutMs = 60_000, model } = opts

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...(model ? ['--model', model] : []),
    ...(sessionId ? ['--resume', sessionId] : []),
  ]

  // Build clean env: spread process.env then delete the six problematic vars.
  // Using delete (not undefined) to avoid EINVAL on Windows.
  const env: NodeJS.ProcessEnv = { ...process.env }
  const varsToDelete = [
    'CLAUDECODE',
    'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_CODE_IS_HEADLESS',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'ELECTRON_RUN_AS_NODE',
  ]
  for (const k of varsToDelete) {
    delete env[k]
  }

  const child = spawn(bin, args, {
    shell: false,
    stdio: ['pipe', 'pipe', 'ignore'],
    env,
  })

  let settled = false

  // Write prompt to stdin then close it.
  // A child that closes its stdin early (a CLI that errors, is missing, or exits
  // before reading its prompt) makes this write emit EPIPE. Swallow it so an
  // unhandled stream error can never crash the SSE handler — the real failure is
  // surfaced via the child 'error'/'close' frames instead.
  child.stdin.on('error', () => { /* ignore EPIPE: child closed stdin early */ })
  if (child.stdin.writable) {
    child.stdin.write(prompt, 'utf-8')
    child.stdin.end()
  }

  // Yield mechanism: use a queue + resolvers so we can yield from the async generator
  // while the child emits events asynchronously.
  const queue: StreamFrame[] = []
  let resolve: (() => void) | null = null
  let finished = false

  function push(frame: StreamFrame): void {
    if (settled) return
    queue.push(frame)
    if (resolve) { const r = resolve; resolve = null; r() }
  }

  function finish(): void {
    if (settled) return
    finished = true
    if (resolve) { const r = resolve; resolve = null; r() }
  }

  // Timeout: kill child and emit error frame
  const killTimer = setTimeout(() => {
    if (!settled) {
      child.kill()
      push({ type: 'error', message: 'timeout' })
      finish()
    }
  }, timeoutMs)

  // Parse stdout lines
  let buf = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf-8')
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const frame = parseClaudeStreamLine(line)
      if (frame) push(frame)
    }
  })

  // Process any remaining buffered text and emit done
  child.on('close', () => {
    if (settled) return
    clearTimeout(killTimer)
    // Flush remaining buffer
    const frame = parseClaudeStreamLine(buf)
    if (frame) push(frame)
    push({ type: 'done' })
    finish()
  })

  // ENOENT or other spawn error
  child.on('error', (err: NodeJS.ErrnoException) => {
    if (settled) return
    clearTimeout(killTimer)
    push({ type: 'error', message: err.message })
    finish()
  })

  // Yield from the queue
  try {
    while (true) {
      // Drain the queue first
      while (queue.length > 0) {
        const frame = queue.shift()!
        // Stop after done or error
        if (frame.type === 'done' || frame.type === 'error') {
          yield frame
          settled = true
          return
        }
        yield frame
      }
      if (finished) {
        break
      }
      // Wait for next push or finish
      await new Promise<void>(res => { resolve = res })
    }
  } finally {
    // Cleanup: kill child if still running (e.g. req.close before stream ends)
    settled = true
    clearTimeout(killTimer)
    try { child.kill() } catch { /* already dead */ }
  }
}
