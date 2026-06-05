/**
 * claude-stream.ts — Async iterable wrapper around a streaming claude CLI spawn.
 *
 * Critical correctness requirements (Windows compatibility):
 *  - Spawn native .exe by full path. NEVER spawn .cmd (EINVAL on Node 18+) or bare
 *    'claude' (ENOENT when npm bin dir is not on PATH). Callers pass a resolved bin path.
 *  - shell: false — required to avoid EINVAL on Windows .cmd shim guard.
 *  - Env hygiene: delete (never set to undefined) the six Claude Code env vars that
 *    interfere with the CLI when spawned from within Claude Code.
 *  - No --model flag — let the CLI default; a hardcoded model id breaks on CLI upgrades.
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

interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  delta: { type: string; text?: string }
}

interface ResultEvent {
  type: 'result';
  session_id?: string;
}

type ClaudeEvent = ContentBlockDeltaEvent | ResultEvent | { type: string }

// ── spawnClaudeStream ──────────────────────────────────────────────────────

export interface SpawnClaudeStreamOpts {
  bin: string;
  prompt: string;
  sessionId?: string;
  timeoutMs?: number;
}

/**
 * Spawn a claude CLI process in streaming JSON mode and yield parsed StreamFrame values.
 * Env hygiene: the six Claude Code env vars are deleted from the spawned process environment
 * (delete, never set to undefined — undefined causes EINVAL on Windows).
 * No --model flag: let the CLI pick its default.
 */
export async function* spawnClaudeStream(
  opts: SpawnClaudeStreamOpts,
): AsyncIterable<StreamFrame> {
  const { bin, prompt, sessionId, timeoutMs = 60_000 } = opts

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
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

  // Write prompt to stdin then close it
  child.stdin.write(prompt, 'utf-8')
  child.stdin.end()

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
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const ev = JSON.parse(trimmed) as ClaudeEvent
        if (ev.type === 'content_block_delta') {
          const cbe = ev as ContentBlockDeltaEvent
          if (cbe.delta.type === 'text_delta' && typeof cbe.delta.text === 'string') {
            push({ type: 'delta', text: cbe.delta.text })
          }
        } else if (ev.type === 'result') {
          const re = ev as ResultEvent
          if (re.session_id) {
            push({ type: 'session', sessionId: re.session_id })
          }
        }
      } catch { /* skip malformed line */ }
    }
  })

  // Process any remaining buffered text and emit done
  child.on('close', () => {
    if (settled) return
    clearTimeout(killTimer)
    // Flush remaining buffer
    if (buf.trim()) {
      try {
        const ev = JSON.parse(buf.trim()) as ClaudeEvent
        if (ev.type === 'result') {
          const re = ev as ResultEvent
          if (re.session_id) push({ type: 'session', sessionId: re.session_id })
        }
      } catch { /* skip */ }
    }
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
