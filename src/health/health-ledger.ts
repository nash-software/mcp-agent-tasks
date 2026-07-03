import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mirrors the schema and semantics of ~/.claude/hooks/lib/health-ledger.js
// (the factory nervous system's single ledger reader/rotator) so events this
// server writes are indistinguishable from ones the hooks lib writes itself.
// This appender deliberately owns neither rotation nor a read API — the
// hooks-side writers already own rotation, and duplicating it here would
// create two independent rotation policies racing on the same file. It must
// stay dependency-free (no cross-package import of the CJS hooks lib) and
// crash-proof: a health-ledger failure must never take down the MCP server.

export const HEALTH_SOURCE = 'daemon:mcp-agent-tasks';

export type HealthEventKind = 'heartbeat' | 'metric' | 'error' | 'use' | 'status';

const KINDS = new Set<HealthEventKind>(['heartbeat', 'metric', 'error', 'use', 'status']);

const APPEND_RETRY_MS = 150; // AV-scan lock pattern (node-windows.md)

export interface HealthEvent {
  source: string;
  kind: HealthEventKind;
  detail?: Record<string, unknown>;
  session?: string | null;
}

function stateDir(): string {
  return process.env.CLAUDE_HEALTH_DIR ?? path.join(os.homedir(), '.claude', 'state');
}

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* busy fallback */ }
  }
}

/**
 * Append one event to the factory health ledger. Never throws — on total
 * failure it leaves a degraded flag the pulse surfaces instead of crashing
 * its host process.
 */
export function appendHealthEvent(event: HealthEvent): void {
  try {
    const { source, kind, detail, session } = event;
    if (!source || !KINDS.has(kind)) return;

    const dir = stateDir();
    const ledgerPath = path.join(dir, 'health.jsonl');
    const degradedFlagPath = path.join(dir, 'health-ledger-degraded');

    const line = JSON.stringify({
      ts: new Date().toISOString(),
      source,
      kind,
      detail: detail ?? {},
      session: session ?? null,
    }) + '\n';

    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.appendFileSync(ledgerPath, line, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EBUSY') {
        sleepSync(APPEND_RETRY_MS);
        fs.appendFileSync(ledgerPath, line, 'utf8');
      } else {
        throw e;
      }
    }

    if (fs.existsSync(degradedFlagPath)) {
      try { fs.unlinkSync(degradedFlagPath); } catch { /* best-effort */ }
    }
  } catch (e) {
    try {
      const dir = stateDir();
      fs.mkdirSync(dir, { recursive: true });
      const message = e instanceof Error ? e.message : String(e);
      fs.writeFileSync(path.join(dir, 'health-ledger-degraded'), `${new Date().toISOString()} ${message}\n`, 'utf8');
    } catch { /* nothing left to do — the ledger must never crash its host */ }
  }
}
