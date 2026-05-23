// @version 1.0.0
'use strict';

// hooks/stop-intent-extractor.js
// Claude Code Stop event hook — extracts task intents from the session transcript
// and creates tasks via agent-tasks create.
//
// Zero npm imports — builtins only.
// Requires hook-internal libs (hooks/lib/): intent-extractor.js, project-router.js

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { extractIntents, REDACT_PATTERNS } = require('./lib/intent-extractor.js');
const { routeProject } = require('./lib/project-router.js');

// ── Sentinel Sets for re-validation ──────────────────────────────────────────
const VALID_TYPES = new Set(['feature', 'bug', 'spike', 'chore']);
const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);

// ── resolveAgentTasksBinary ───────────────────────────────────────────────────
// Resolve the agent-tasks binary using where/which, then trusted roots.
// Copied/adapted from passive-capture.js pattern.
function resolveAgentTasksBinary() {
  const { execSync } = require('child_process');
  const os = require('os');

  function pickBestBinary(lines, platform) {
    const nonEmpty = lines.filter(l => typeof l === 'string' && l.trim() !== '');
    if (nonEmpty.length === 0) return null;
    if (platform === 'win32') {
      const cmd = nonEmpty.find(l => l.toLowerCase().endsWith('.cmd'));
      if (cmd) return cmd;
    }
    return nonEmpty[0];
  }

  function isTrustedPath(p) {
    if (!p) return false;
    const normalized = p.replace(/\\/g, '/').toLowerCase();
    const tmpDir = os.tmpdir().replace(/\\/g, '/').toLowerCase();
    if (normalized.startsWith('/tmp/') || normalized.startsWith(tmpDir + '/') || normalized === tmpDir) return false;
    if (/\/(tmp|temp|public|world)\//i.test(normalized)) return false;
    return true;
  }

  // Try where/which first
  try {
    const stdout = execSync(
      process.platform === 'win32'
        ? 'where agent-tasks 2>NUL'
        : 'which agent-tasks 2>/dev/null',
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const best = pickBestBinary(stdout.trim().split(/\r?\n/), process.platform);
    if (best && isTrustedPath(best)) return best;
  } catch { /* not in PATH */ }

  // Trusted-roots fallback
  const trustedRoots = [
    os.homedir(),
    (function () {
      try { return execSync('npm root -g', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
    })(),
    path.dirname(process.execPath),
  ].filter(Boolean);

  for (const root of trustedRoots) {
    const candidate = path.join(root, 'node_modules', '.bin', 'agent-tasks');
    if (isTrustedPath(candidate)) return candidate;
  }

  // Final fallback: dist/cli.js relative to hooks/
  const projectRoot = path.resolve(__dirname, '..');
  const distCli = path.join(projectRoot, 'dist', 'cli.js');
  if (isTrustedPath(distCli)) return distCli;

  return 'agent-tasks'; // caller handles missing binary
}

// ── sanitizeField ─────────────────────────────────────────────────────────────
// Strips control characters, re-applies REDACT_PATTERNS, trims, and truncates.
function sanitizeField(value, maxLen) {
  if (typeof value !== 'string') return '';
  // Strip control characters
  let result = value.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  // Re-apply REDACT_PATTERNS
  for (const pattern of REDACT_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }
  result = result.trim();
  if (maxLen && result.length > maxLen) {
    result = result.slice(0, maxLen);
  }
  return result;
}

// ── readIndexYaml ─────────────────────────────────────────────────────────────
// Reads the target project's index.yaml line-by-line to build a Set of existing
// task titles for deduplication.
//
// State machine (spec §5.1 + N4 fixes):
//   - Skip file if > 500 KB (log stderr, return empty set)
//   - Skip lines > 2048 chars (N4: mark block as skip-title)
//   - State: { currentId, currentTitle } — flush on new `id:`, first-title-wins
//   - N4 fix 1: if same currentId appears again, discard second title
//   - N4 fix 2: if `title:` seen with no currentId in scope, discard (orphaned)
//   - Multiline YAML titles (| or >): set currentTitle = null, mark block as skip
//   - Only record entries where ID prefix matches targetPrefix
function readIndexYaml(indexYamlPath, targetPrefix) {
  const existingTitles = new Set();

  try {
    if (!fs.existsSync(indexYamlPath)) {
      process.stderr.write(`[stop-intent] index.yaml not found at ${indexYamlPath} — skipping dedup\n`);
      return existingTitles;
    }

    const stat = fs.statSync(indexYamlPath);
    if (stat.size > 500 * 1024) {
      process.stderr.write('[stop-intent] index.yaml > 500 KB — skipping dedup\n');
      return existingTitles;
    }

    const content = fs.readFileSync(indexYamlPath, 'utf-8');
    const lines = content.split(/\r?\n/);

    // State machine variables
    let currentId = null;
    let currentTitle = null;
    let skipTitle = false; // true if title is multiline YAML or line too long
    // Track IDs already seen for first-title-wins dedup
    const seenIds = new Set();

    for (const line of lines) {
      // Skip lines > 2048 chars (N4)
      if (line.length > 2048) {
        // If this is a title line, mark block as skip
        if (/^\s+title:\s/.test(line)) {
          skipTitle = true;
        }
        continue;
      }

      // Detect new id: line (a new task block begins)
      const idMatch = line.match(/^\s*-?\s*id:\s+(\S+)/);
      if (idMatch) {
        // Flush previous block before starting new one
        if (currentId && currentTitle && !skipTitle) {
          const prefix = currentId.split('-')[0];
          if (prefix === targetPrefix) {
            existingTitles.add(currentTitle.toLowerCase());
            seenIds.add(currentId);
          }
        }
        // Start new block
        const newId = idMatch[1];
        if (seenIds.has(newId)) {
          // N4 fix 1: duplicate ID — use sentinel to discard second title
          currentId = newId;
          currentTitle = null;
          skipTitle = true; // discard title for this duplicate block
        } else {
          currentId = newId;
          currentTitle = null;
          skipTitle = false;
        }
        continue;
      }

      // Detect title: line
      const titleMatch = line.match(/^\s+title:\s+(.+)$/);
      if (titleMatch) {
        if (!currentId) {
          // N4 fix 2: orphaned title line (no id in scope) — discard
          continue;
        }
        if (skipTitle) {
          continue;
        }
        const titleValue = titleMatch[1].trim();
        // Check for multiline YAML indicator
        if (titleValue === '|' || titleValue === '>') {
          // Multiline title — skip
          currentTitle = null;
          skipTitle = true;
          continue;
        }
        // Only set if not already set (first-title-wins within a block)
        if (currentTitle === null) {
          // Strip surrounding quotes if present
          const stripped = titleValue.replace(/^['"]|['"]$/g, '');
          currentTitle = stripped;
        }
        continue;
      }
    }

    // Flush final block
    if (currentId && currentTitle && !skipTitle) {
      const prefix = currentId.split('-')[0];
      if (prefix === targetPrefix) {
        existingTitles.add(currentTitle.toLowerCase());
      }
    }
  } catch (err) {
    process.stderr.write(`[stop-intent] Error reading index.yaml: ${err.message} — skipping dedup\n`);
  }

  return existingTitles;
}

// ── computeAggregatedHint ─────────────────────────────────────────────────────
// Returns the most-common non-null project_hint across intents.
// Ties broken by first occurrence. Returns null if all hints are null.
function computeAggregatedHint(intents) {
  const freq = new Map();
  const firstSeen = new Map();

  for (let i = 0; i < intents.length; i++) {
    const hint = intents[i].project_hint;
    if (hint == null) continue;
    freq.set(hint, (freq.get(hint) || 0) + 1);
    if (!firstSeen.has(hint)) firstSeen.set(hint, i);
  }

  if (freq.size === 0) return null;

  // Find the hint with the highest frequency, ties broken by first occurrence (lower index)
  let bestHint = null;
  let bestCount = 0;
  let bestFirst = Infinity;

  for (const [hint, count] of freq.entries()) {
    const first = firstSeen.get(hint);
    if (count > bestCount || (count === bestCount && first < bestFirst)) {
      bestHint = hint;
      bestCount = count;
      bestFirst = first;
    }
  }

  return bestHint;
}

// ── Main entry point ──────────────────────────────────────────────────────────
if (require.main === module) {
  const startTime = Date.now();

  // Check disabled flag — silent exit
  if (process.env.MCP_TASKS_STOP_HOOK_DISABLED === '1') {
    process.exit(0);
  }

  // Read stdin synchronously
  let rawStdin = '';
  try {
    rawStdin = fs.readFileSync('/dev/stdin', 'utf-8');
  } catch {
    // On Windows or if /dev/stdin unavailable, read from fd 0
    try {
      const bufSize = 65536;
      const buf = Buffer.alloc(bufSize);
      let totalRead = 0;
      const chunks = [];
      let bytesRead;
      do {
        try {
          bytesRead = fs.readSync(0, buf, 0, bufSize, null);
          if (bytesRead > 0) {
            chunks.push(buf.slice(0, bytesRead).toString('utf-8'));
            totalRead += bytesRead;
          }
        } catch {
          break;
        }
      } while (bytesRead === bufSize);
      rawStdin = chunks.join('');
    } catch {
      rawStdin = '';
    }
  }

  // N3: Guard against oversized stdin before JSON.parse
  if (Buffer.byteLength(rawStdin, 'utf8') > 512 * 1024) {
    process.exit(0);
  }

  // Handle empty stdin
  if (!rawStdin || !rawStdin.trim()) {
    process.exit(0);
  }

  // Parse JSON
  let payload;
  try {
    payload = JSON.parse(rawStdin);
  } catch {
    process.exit(0);
  }

  // Top-level validation: must be an object
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    process.exit(0);
  }

  // Validate transcript: must be an array
  if (!Array.isArray(payload.transcript)) {
    process.exit(0);
  }

  // CWD: use provided or fall back to process.cwd()
  const cwd = (typeof payload.cwd === 'string' && payload.cwd.trim())
    ? payload.cwd.trim()
    : process.cwd();

  // Pre-LLM noise filter: scratchpad cwd
  if (/[/\\]scratchpads([/\\]|$)/i.test(cwd)) {
    process.exit(0);
  }

  // Filter transcript to only well-formed { role: 'user'|'assistant', content: string } entries
  const filteredTranscript = payload.transcript.filter(entry => {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.role !== 'user' && entry.role !== 'assistant') return false;
    if (typeof entry.content !== 'string') return false;
    return true;
  });

  // Pre-LLM noise filter: < 4 entries → silent exit
  if (filteredTranscript.length < 4) {
    process.exit(0);
  }

  // Pre-LLM noise filter: all-assistant → silent exit
  const hasUserMessage = filteredTranscript.some(e => e.role === 'user');
  if (!hasUserMessage) {
    process.exit(0);
  }

  // Call extractIntents from intent-extractor lib
  const intents = extractIntents(filteredTranscript, 20000);

  // No intents → exit 0
  if (!Array.isArray(intents) || intents.length === 0) {
    process.exit(0);
  }

  // Compute aggregated project hint
  const aggregatedHint = computeAggregatedHint(intents);

  // Route to project
  const projectRoute = routeProject(cwd, aggregatedHint);
  if (!projectRoute) {
    process.stderr.write('[stop-intent] Routing failed — all intents dropped this session\n');
    process.exit(0);
  }

  const { prefix: targetPrefix, tasksDir } = projectRoute;

  // Read existing titles from index.yaml for deduplication
  const indexYamlPath = path.join(tasksDir, 'index.yaml');
  const existingTitles = readIndexYaml(indexYamlPath, targetPrefix);

  // N2: Check time budget before intent creation loop
  if (Date.now() - startTime >= 25000) {
    process.stderr.write('[stop-intent] Time budget exceeded before intent creation loop — exiting\n');
    process.exit(0);
  }

  // Resolve agent-tasks binary
  const agentTasksBinary = resolveAgentTasksBinary();
  const creationTimeoutMs = parseInt(process.env.MCP_TASKS_CREATION_TIMEOUT_MS || '1000', 10);

  // Intent creation loop
  for (const intent of intents) {
    // N2: Budget check at top of each iteration
    if (Date.now() - startTime >= 25000) {
      process.stderr.write('[stop-intent] Time budget exceeded during intent creation loop — stopping\n');
      break;
    }

    // Sanitize title and why
    const title = sanitizeField(intent.title || '', 80);
    const why = sanitizeField(intent.why || '', 300);

    // Skip if empty title after sanitization
    if (!title) continue;

    // Re-validate type and priority; substitute defaults on invalid
    const type = VALID_TYPES.has(intent.type) ? intent.type : 'chore';
    const priority = VALID_PRIORITIES.has(intent.priority) ? intent.priority : 'medium';

    // Deduplication check against existing titles
    if (existingTitles.has(title.toLowerCase())) {
      process.stderr.write(`[stop-intent] Skipping duplicate: "${title}"\n`);
      continue;
    }

    // Spawn agent-tasks create
    const args = [
      'create',
      '--project', targetPrefix,
      '--title', title,
      '--type', type,
      '--priority', priority,
      '--auto-captured',
    ];

    if (why) {
      args.push('--why', why);
    }

    // If the binary is a .js file, invoke via node
    let spawnBin;
    let spawnArgs;
    if (agentTasksBinary.endsWith('.js')) {
      spawnBin = process.execPath;
      spawnArgs = [agentTasksBinary, ...args];
    } else {
      spawnBin = agentTasksBinary;
      spawnArgs = args;
    }

    const createResult = spawnSync(spawnBin, spawnArgs, {
      encoding: 'utf-8',
      timeout: creationTimeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (createResult.error || createResult.status !== 0) {
      const errMsg = createResult.error
        ? createResult.error.message
        : (createResult.stderr || '').trim() || `exit ${createResult.status}`;
      process.stderr.write(`[stop-intent] Failed to create task "${title}": ${errMsg}\n`);
      continue;
    }

    // Parse stdout for task ID
    const stdout = (createResult.stdout || '').trim();
    const idMatch = stdout.match(/^([A-Z]+-\d+)/m);
    if (idMatch) {
      process.stderr.write(`[stop-intent] Created ${idMatch[1]}: "${title}"\n`);
    } else {
      process.stderr.write(`[stop-intent] Created task (no ID parsed): "${title}"\n`);
    }
  }

  process.exit(0);
}
