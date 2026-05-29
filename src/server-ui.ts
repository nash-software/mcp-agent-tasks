import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { loadConfig, getDbPath, DEFAULT_TASKS_DIR_NAME, resolveServerDbPath } from './config/loader.js';
import { SqliteIndex } from './store/sqlite-index.js';
import { MilestoneRepository } from './store/milestone-repository.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ActivityEntry {
  task_id: string;
  title: string;
  from_status: string;
  to_status: string;
  at: string;
  reason: string | null;
}

export interface UiServerHandle {
  url: string;
  close: () => Promise<void>;
}

export interface ArtifactEntry {
  path: string;
  project: string;
  created_at: string;
  last_opened_at: string | null;
  task_id: string | null;
  staleDays: number;
}

// ── ACR status cache ──────────────────────────────────────────────────────────
export interface AcrJob {
  id: string;
  title: string;
  status: string;
}

export interface AcrStatusResponse {
  offline: boolean;
  jobs: AcrJob[];
}

let acrCache: { data: AcrStatusResponse; expiresAt: number } | null = null;

// ── Brain search ──────────────────────────────────────────────────────────────
const BRAIN_MCP_URL = process.env['BRAIN_MCP_URL'] ?? 'http://localhost:8093';

export interface BrainResult {
  title: string;
  snippet: string;
  source?: string;
}

export interface BrainSearchResponse {
  results: BrainResult[];
  query: string;
  offline?: boolean;
}

async function fetchBrainSearch(q: string): Promise<BrainSearchResponse> {
  try {
    const res = await fetch(`${BRAIN_MCP_URL}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'brain_search', arguments: { query: q } },
        id: 1,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json() as { result?: { content?: Array<{ text?: string }> } };
    // MCP tool result format: result.content[0].text is a JSON string of the results array
    const contentText = data.result?.content?.[0]?.text;
    if (typeof contentText !== 'string') {
      return { results: [], query: q };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contentText);
    } catch {
      return { results: [], query: q };
    }
    const rawResults = Array.isArray(parsed) ? parsed : [];
    const results: BrainResult[] = rawResults.map((r) => {
      const item = r as Record<string, unknown>;
      return {
        title: typeof item['title'] === 'string' ? item['title'] : String(item['title'] ?? ''),
        snippet: typeof item['snippet'] === 'string' ? item['snippet'] : String(item['snippet'] ?? ''),
        ...(typeof item['source'] === 'string' ? { source: item['source'] } : {}),
      };
    });
    return { results, query: q };
  } catch {
    return { results: [], query: q, offline: true };
  }
}

/** Reset the ACR cache — for testing only. */
export function resetAcrCache(): void {
  acrCache = null;
}

async function fetchAcrStatus(): Promise<AcrStatusResponse> {
  try {
    const res = await fetch('http://localhost:3001/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'acr_status', arguments: {} },
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json() as { result?: { jobs?: unknown[] } };
    const rawJobs = Array.isArray(data.result?.jobs) ? data.result.jobs : [];
    const jobs: AcrJob[] = rawJobs.map((j) => {
      const job = j as Record<string, unknown>;
      return {
        id: typeof job['id'] === 'string' ? job['id'] : String(job['id'] ?? ''),
        title: typeof job['title'] === 'string' ? job['title'] : String(job['title'] ?? ''),
        status: typeof job['status'] === 'string' ? job['status'] : String(job['status'] ?? ''),
      };
    });
    return { offline: false, jobs };
  } catch {
    return { offline: true, jobs: [] };
  }
}

// ── artifacts opened store ────────────────────────────────────────────────────
// In-memory cache of artifacts-opened.json, loaded lazily on first request.
const MCP_TASKS_DIR = join(homedir(), '.mcp-tasks');
const ARTIFACTS_JSONL = join(MCP_TASKS_DIR, 'artifacts.jsonl');
const ARTIFACTS_OPENED_JSON = join(MCP_TASKS_DIR, 'artifacts-opened.json');

let openedStore: Record<string, string> | null = null;

function loadOpenedStore(): Record<string, string> {
  if (openedStore !== null) return openedStore;
  try {
    if (existsSync(ARTIFACTS_OPENED_JSON)) {
      const raw = readFileSync(ARTIFACTS_OPENED_JSON, 'utf-8');
      openedStore = JSON.parse(raw) as Record<string, string>;
    } else {
      openedStore = {};
    }
  } catch {
    openedStore = {};
  }
  return openedStore;
}

function saveOpenedStore(store: Record<string, string>): void {
  try {
    mkdirSync(MCP_TASKS_DIR, { recursive: true });
    const tmp = ARTIFACTS_OPENED_JSON + '.tmp.' + process.pid;
    writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
    renameSync(tmp, ARTIFACTS_OPENED_JSON);
  } catch { /* non-fatal */ }
}

function readArtifacts(): ArtifactEntry[] {
  if (!existsSync(ARTIFACTS_JSONL)) return [];
  let lines: string[];
  try {
    lines = readFileSync(ARTIFACTS_JSONL, 'utf-8').split('\n').filter(l => l.trim() !== '');
  } catch {
    return [];
  }

  interface RawRecord {
    path?: unknown;
    project?: unknown;
    created_at?: unknown;
    task_id?: unknown;
  }

  // Parse and collect — keep latest created_at per path
  const byPath = new Map<string, { project: string; created_at: string; task_id: string | null }>();
  const now = Date.now();
  const thirtyDaysMs = 30 * 86_400_000;

  for (const line of lines) {
    try {
      const r = JSON.parse(line) as RawRecord;
      if (typeof r.path !== 'string' || typeof r.created_at !== 'string') continue;
      const createdMs = new Date(r.created_at).getTime();
      if (isNaN(createdMs) || now - createdMs > thirtyDaysMs) continue;
      const existing = byPath.get(r.path);
      if (!existing || new Date(r.created_at) > new Date(existing.created_at)) {
        byPath.set(r.path, {
          project: typeof r.project === 'string' ? r.project : 'GEN',
          created_at: r.created_at,
          task_id: typeof r.task_id === 'string' ? r.task_id : null,
        });
      }
    } catch { /* skip bad line */ }
  }

  const opened = loadOpenedStore();

  const entries: ArtifactEntry[] = [];
  for (const [p, rec] of byPath) {
    const createdMs = new Date(rec.created_at).getTime();
    const staleDays = Math.floor((now - createdMs) / 86_400_000);
    entries.push({
      path: p,
      project: rec.project,
      created_at: rec.created_at,
      last_opened_at: opened[p] ?? null,
      task_id: rec.task_id,
      staleDays,
    });
  }

  // Sort: null last_opened_at first (never opened = most stale), then ascending by last_opened_at
  entries.sort((a, b) => {
    if (a.last_opened_at === null && b.last_opened_at === null) return 0;
    if (a.last_opened_at === null) return -1;
    if (b.last_opened_at === null) return 1;
    return new Date(a.last_opened_at).getTime() - new Date(b.last_opened_at).getTime();
  });

  return entries;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.map':  'application/json',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

function serveStatic(res: ServerResponse, filePath: string): void {
  if (!existsSync(filePath)) {
    sendError(res, 404, `Not found: ${filePath}`);
    return;
  }
  const content = readFileSync(filePath);
  const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
  res.end(content);
}

interface MultipartFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

function extractMultipartFile(body: Buffer, boundary: string): MultipartFile | null {
  const boundaryBuf = Buffer.from('--' + boundary);
  const parts: Buffer[] = [];
  let start = 0;
  while (true) {
    const idx = body.indexOf(boundaryBuf, start);
    if (idx === -1) break;
    if (start > 0) parts.push(body.subarray(start, idx));
    start = idx + boundaryBuf.length;
  }
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.subarray(0, headerEnd).toString();
    if (!headers.includes('filename=')) continue;
    const fnMatch = headers.match(/filename="([^"]+)"/);
    const ctMatch = headers.match(/Content-Type:\s*(.+)/i);
    const data = part.subarray(headerEnd + 4, part.length - 2);
    return {
      filename: fnMatch ? fnMatch[1] : 'audio.wav',
      contentType: ctMatch ? ctMatch[1].trim() : 'audio/wav',
      data,
    };
  }
  return null;
}

interface ProjectIndex {
  prefix: string;
  index: SqliteIndex;
  milestoneRepo: MilestoneRepository;
}

function openProjectIndexes(config: ReturnType<typeof loadConfig>): ProjectIndex[] {
  const tasksDirName = config.tasksDirName ?? DEFAULT_TASKS_DIR_NAME;

  if (config.projects.length === 0) {
    // No registered projects â€” fall back to global DB
    const idx = new SqliteIndex(getDbPath());
    idx.init();
    return [{ prefix: 'default', index: idx, milestoneRepo: new MilestoneRepository(idx.getRawDb()) }];
  }

  const indexes = config.projects.map(p => {
    const tasksDir = join(p.path, tasksDirName);
    const dbPath = resolveServerDbPath(tasksDir, config, p.prefix);
    const idx = new SqliteIndex(dbPath);
    idx.init();
    return { prefix: p.prefix, index: idx, milestoneRepo: new MilestoneRepository(idx.getRawDb()) };
  });

  const genDbPath = join(homedir(), '.mcp-tasks', 'tasks', 'gen', '.index.db');
  if (existsSync(genDbPath)) {
    const genIdx = new SqliteIndex(genDbPath);
    genIdx.init();
    indexes.push({ prefix: 'GEN', index: genIdx, milestoneRepo: new MilestoneRepository(genIdx.getRawDb()) });
  }

  return indexes;
}

function rerouteTask(taskId: string, targetPrefix: string, projectIndexes: ProjectIndex[]): void {
  const sourceIdx = projectIndexes.find(p => taskId.startsWith(p.prefix + '-'));
  if (!sourceIdx) return;

  const targetIdx = projectIndexes.find(p => p.prefix === targetPrefix);
  if (!targetIdx || targetIdx === sourceIdx) return; // already there or target doesn't exist

  const task = sourceIdx.index.getTask(taskId);
  if (!task) return;

  // Assign a new ID in the target project
  const num = targetIdx.index.nextId(targetPrefix);
  const newId = `${targetPrefix}-${String(num).padStart(3, '0')}`;
  const now = new Date().toISOString();
  const rerouted = {
    ...task,
    id: newId,
    project: targetPrefix,
    file_path: `${newId}.md`,
    updated: now,
    last_activity: now,
  };
  targetIdx.index.upsertTask(rerouted);
  sourceIdx.index.deleteTask(taskId);
}

function spawnBackgroundRouting(
  text: string,
  taskId: string,
  projectIndexes: ProjectIndex[],
  genIdx: ProjectIndex,
): void {
  // Explicit #prefix routing — skip LLM entirely
  const prefixMatch = text.match(/^#([A-Za-z]+)\s+/);
  if (prefixMatch) {
    const candidate = prefixMatch[1].toUpperCase();
    const match = projectIndexes.find(p => p.prefix === candidate);
    if (match && match !== genIdx) {
      rerouteTask(taskId, match.prefix, projectIndexes);
    }
    return;
  }

  // LLM routing via claude CLI
  const prefixList = projectIndexes.map(p => p.prefix).join(', ');
  const prompt = `Given this task: '${text}', which project prefix from [${prefixList}] best fits? Reply with ONLY the prefix or GEN.`;

  let finished = false;
  let stdout = '';

  try {
    const child = spawn('claude', ['-p', prompt], {
      detached: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill();
      }
    }, 30_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on('close', () => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;
      const resolved = stdout.trim().toUpperCase().replace(/[^A-Z]/g, '');
      if (resolved && resolved !== genIdx.prefix) {
        const target = projectIndexes.find(p => p.prefix === resolved);
        if (target) {
          rerouteTask(taskId, resolved, projectIndexes);
        }
      }
    });

    child.on('error', () => {
      clearTimeout(timer);
      finished = true;
      // Task stays in GEN — silent fallback
    });
  } catch {
    // Spawn failure — task stays in GEN, no error surfaced
  }
}

export async function startUiServer(opts: { port: number; openBrowser?: boolean }): Promise<UiServerHandle> {
  const config = loadConfig();
  const projectIndexes = openProjectIndexes(config);

  const uiDir = join(__dirname, '..', 'dist', 'ui');

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const pathname = url.pathname;

    try {
      // Static assets â€” /assets/* (guard against path traversal)
      if (pathname.startsWith('/assets/')) {
        const resolved = resolve(join(uiDir, pathname));
        if (!resolved.startsWith(resolve(uiDir))) {
          sendError(res, 404, 'Not found');
          return;
        }
        serveStatic(res, resolved);
        return;
      }

      // HTML entry point
      if (pathname === '/' || pathname === '/index.html') {
        const indexPath = join(uiDir, 'index.html');
        if (existsSync(indexPath)) {
          serveStatic(res, indexPath);
        } else {
          sendError(res, 404, 'Dashboard not built. Run npm run build first.');
        }
        return;
      }

      // API: projects (for action button)
      if (pathname === '/api/projects') {
        const projects = config.projects.map(p => ({ prefix: p.prefix, path: p.path }));
        sendJson(res, 200, projects);
        return;
      }

      // API: config (conductor URLs for action button + project prefix list for capture)
      if (pathname === '/api/config') {
        const cfg: Record<string, unknown> = {};
        const localUrl = process.env['CONDUCTOR_LOCAL_URL'];
        const vpsUrl = process.env['CONDUCTOR_VPS_URL'];
        if (localUrl) cfg.conductorLocalUrl = localUrl;
        if (vpsUrl) cfg.conductorVpsUrl = vpsUrl;
        cfg.projectPrefixes = projectIndexes.map(p => p.prefix);
        sendJson(res, 200, cfg);
        return;
      }

      // API: tasks
      if (pathname === '/api/tasks' && req.method !== 'POST') {
        const projectFilter = url.searchParams.get('project') ?? undefined;
        const status = url.searchParams.get('status') ?? undefined;
        const milestone = url.searchParams.get('milestone') ?? undefined;
        const label = url.searchParams.get('label') ?? undefined;
        const autoCapturedParam = url.searchParams.get('auto_captured');
        const autoCaptured = autoCapturedParam === 'true' ? true
          : autoCapturedParam === 'false' ? false : undefined;

        const indexes = projectFilter
          ? projectIndexes.filter(p => p.prefix === projectFilter)
          : projectIndexes;

        let tasks = indexes.flatMap(p =>
          p.index.listTasks({
            project: p.prefix,
            status: status as Parameters<typeof p.index.listTasks>[0]['status'],
            auto_captured: autoCaptured,
            limit: 1000,
          }),
        );

        if (milestone !== undefined) {
          tasks = tasks.filter(t => t.milestone === milestone);
        }
        if (label !== undefined) {
          tasks = tasks.filter(t => t.labels?.includes(label) ?? false);
        }

        sendJson(res, 200, tasks);
        return;
      }

      // API: milestones (list)
      if (pathname === '/api/milestones' && req.method === 'GET') {
        const milestones = projectIndexes.flatMap(p => p.milestoneRepo.listMilestones());
        sendJson(res, 200, milestones);
        return;
      }

      // API: stats
      if (pathname === '/api/stats') {
        const statsResult = projectIndexes.map(p => ({
          project: p.prefix,
          stats: p.index.getStats(p.prefix),
        }));
        sendJson(res, 200, statsResult);
        return;
      }

      // API: activity
      if (pathname === '/api/activity') {
        const activity: ActivityEntry[] = projectIndexes
          .flatMap(p => p.index.getRecentActivity(50))
          .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
          .slice(0, 50);
        sendJson(res, 200, activity);
        return;
      }

      // API: create milestone
      if (pathname === '/api/milestones' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString()) as {
              id: string; title: string; project: string; description?: string; due_date?: string;
            };
            if (!body.id || typeof body.id !== 'string' ||
                !body.title || typeof body.title !== 'string' ||
                !body.project || typeof body.project !== 'string') {
              sendJson(res, 400, { error: 'MISSING_FIELDS', message: 'id, title, and project are required strings' });
              return;
            }
            const pIdx = projectIndexes.find(p => p.prefix === body.project);
            if (!pIdx) {
              sendJson(res, 404, { error: 'PROJECT_NOT_FOUND' });
              return;
            }
            const now = new Date().toISOString();
            pIdx.milestoneRepo.createMilestone({
              id: body.id,
              title: body.title,
              description: body.description,
              due_date: body.due_date,
              status: 'open',
              created: now,
              project: body.project,
            });
            sendJson(res, 201, { id: body.id, title: body.title, status: 'open', project: body.project });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sendJson(res, 400, { error: 'INVALID_BODY', message: msg });
          }
        });
        return;
      }

      // API: create draft task from dashboard
      if (pathname === '/api/tasks' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString()) as {
              title: string; project: string; body?: string;
            };
            if (!body.title || typeof body.title !== 'string' ||
                !body.project || typeof body.project !== 'string') {
              sendJson(res, 400, { error: 'MISSING_FIELDS', message: 'title and project are required strings' });
              return;
            }
            const pIdx = projectIndexes.find(p => p.prefix === body.project);
            if (!pIdx) {
              sendJson(res, 404, { error: 'PROJECT_NOT_FOUND' });
              return;
            }
            const num = pIdx.index.nextId(body.project);
            const id = `${body.project}-${String(num).padStart(3, '0')}`;
            const now = new Date().toISOString();
            const task = {
              schema_version: 1, id, title: body.title, type: 'plan' as const,
              status: 'draft' as const, priority: 'medium' as const, project: body.project,
              tags: [], complexity: 1, complexity_manual: false, why: '',
              created: now, updated: now, last_activity: now,
              claimed_by: null, claimed_at: null, claim_ttl_hours: 4,
              parent: null, children: [], dependencies: [], subtasks: [],
              git: { commits: [] }, transitions: [], files: [],
              body: body.body ?? '', file_path: `${id}.md`,
              auto_captured: false,
            };
            pIdx.index.upsertTask(task);
            sendJson(res, 201, { id, title: body.title, status: 'draft', project: body.project });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sendJson(res, 400, { error: 'INVALID_BODY', message: msg });
          }
        });
        return;
      }

      // API: promote draft â†’ todo
      const promoteMatch = pathname.match(/^\/api\/tasks\/([A-Z]+-\d+)\/promote$/);
      if (promoteMatch && req.method === 'POST') {
        const taskId = promoteMatch[1];
        const pIdx = projectIndexes.find(p => taskId.startsWith(p.prefix + '-'));
        const task = pIdx ? pIdx.index.getTask(taskId) : null;
        if (!task) {
          sendJson(res, 404, { error: 'TASK_NOT_FOUND' });
          return;
        }
        if (task.status !== 'draft') {
          sendJson(res, 400, { error: 'INVALID_TRANSITION', message: `Task is '${task.status}', not 'draft'` });
          return;
        }
        const now = new Date().toISOString();
        task.transitions.push({ from: 'draft', to: 'todo', at: now, reason: 'Promoted from staging' });
        task.status = 'todo';
        task.updated = now;
        task.last_activity = now;
        pIdx!.index.upsertTask(task);
        sendJson(res, 200, task);
        return;
      }

      // API: transcribe audio via Groq Whisper
      if (pathname === '/api/transcribe' && req.method === 'POST') {
        const contentType = req.headers['content-type'] ?? '';
        if (!contentType.includes('multipart/form-data')) {
          sendJson(res, 400, { error: 'NO_AUDIO', message: 'Expected multipart/form-data with audio file' });
          return;
        }
        const groqKey = process.env['GROQ_API_KEY'];
        if (!groqKey) {
          sendJson(res, 500, { error: 'GROQ_NOT_CONFIGURED', message: 'GROQ_API_KEY not set' });
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', async () => {
          try {
            const raw = Buffer.concat(chunks);
            const boundary = contentType.split('boundary=')[1];
            if (!boundary) {
              sendJson(res, 400, { error: 'NO_AUDIO', message: 'Missing multipart boundary' });
              return;
            }
            const audioPart = extractMultipartFile(raw, boundary);
            if (!audioPart) {
              sendJson(res, 400, { error: 'NO_AUDIO', message: 'No audio file found in request' });
              return;
            }
            const groqForm = new FormData();
            groqForm.append('file', new Blob([audioPart.data], { type: audioPart.contentType }), audioPart.filename);
            groqForm.append('model', 'whisper-large-v3-turbo');
            const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${groqKey}` },
              body: groqForm,
            });
            if (!groqRes.ok) {
              const errText = await groqRes.text();
              sendJson(res, 502, { error: 'GROQ_ERROR', message: errText });
              return;
            }
            const result = await groqRes.json() as { text: string };
            sendJson(res, 200, { text: result.text });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: 'TRANSCRIBE_FAILED', message: msg });
          }
        });
        return;
      }

      // API: today view — committed tasks + candidates + capacity
      if (pathname === '/api/today' && req.method === 'GET') {
        const today = new Date().toISOString().slice(0, 10);
        const targetParam = url.searchParams.get('target');
        let targetMinutes = 360;
        if (targetParam !== null) {
          const parsed = parseInt(targetParam, 10);
          if (!Number.isFinite(parsed) || parsed < 60 || parsed > 600) {
            sendError(res, 400, 'target must be an integer between 60 and 600');
            return;
          }
          targetMinutes = parsed;
        }

        const committed = projectIndexes.flatMap(p => p.index.getTasksByScheduledDate(today));
        committed.sort((a, b) => {
          const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
          const pa = priorityOrder[a.priority] ?? 4;
          const pb = priorityOrder[b.priority] ?? 4;
          if (pa !== pb) return pa - pb;
          return a.title.localeCompare(b.title);
        });

        const candidates = projectIndexes
          .flatMap(p => p.index.getCandidates(20))
          .sort((a, b) => {
            const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
            const pa = priorityOrder[a.priority] ?? 4;
            const pb = priorityOrder[b.priority] ?? 4;
            if (pa !== pb) return pa - pb;
            return a.title.localeCompare(b.title);
          })
          .slice(0, 20);

        const committedMinutes = committed.reduce((sum, t) => {
          return sum + ((t.estimate_hours ?? 0) * 60);
        }, 0);

        sendJson(res, 200, {
          committed,
          candidates,
          capacity: { committedMinutes, targetMinutes },
        });
        return;
      }

      // API: schedule a task for a specific date (or clear it)
      const scheduleMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/schedule$/);
      if (scheduleMatch && req.method === 'POST') {
        const taskId = scheduleMatch[1];
        const pIdx = projectIndexes.find(p => taskId.startsWith(p.prefix + '-'));
        const task = pIdx ? pIdx.index.getTask(taskId) : null;
        if (!task) {
          sendError(res, 404, 'TASK_NOT_FOUND');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString()) as { date: string | null };
            if (body.date !== null && body.date !== undefined) {
              if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
                sendError(res, 400, 'date must be YYYY-MM-DD or null');
                return;
              }
            }
            const now = new Date().toISOString();
            task.scheduled_for = body.date ?? null;
            task.updated = now;
            task.last_activity = now;
            pIdx!.index.upsertTask(task);
            sendJson(res, 200, task);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sendError(res, 400, msg);
          }
        });
        return;
      }

      // API: quick capture — instant GEN inbox write + background LLM routing
      if (pathname === '/api/capture/quick' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString()) as { text?: unknown };
            if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
              sendJson(res, 400, { error: 'EMPTY_TEXT', message: 'text is required and must not be empty' });
              return;
            }
            if (body.text.length > 2000) {
              sendJson(res, 400, { error: 'TEXT_TOO_LONG', message: 'text must be 2000 characters or fewer' });
              return;
            }
            const text = body.text.trim();

            // Resolve the GEN project index (always store to GEN inbox)
            const genIdx = projectIndexes.find(p => p.prefix === 'GEN') ?? projectIndexes[0];
            if (!genIdx) {
              sendJson(res, 500, { error: 'NO_PROJECT', message: 'No project index available' });
              return;
            }

            const num = genIdx.index.nextId(genIdx.prefix);
            const taskId = `${genIdx.prefix}-${String(num).padStart(3, '0')}`;
            const now = new Date().toISOString();
            const task = {
              schema_version: 1,
              id: taskId,
              title: text.slice(0, 120),
              type: 'chore' as const,
              status: 'todo' as const,
              priority: 'medium' as const,
              project: genIdx.prefix,
              tags: [],
              complexity: 1,
              complexity_manual: false,
              why: '',
              created: now,
              updated: now,
              last_activity: now,
              claimed_by: null,
              claimed_at: null,
              claim_ttl_hours: 4,
              parent: null,
              children: [],
              dependencies: [],
              subtasks: [],
              git: { commits: [] },
              transitions: [],
              files: [],
              body: text,
              file_path: `${taskId}.md`,
              auto_captured: true,
            };
            genIdx.index.upsertTask(task);

            // Respond immediately — background routing is fire-and-forget
            sendJson(res, 200, { taskId, project: genIdx.prefix });

            // Background routing: #prefix explicit, or LLM
            spawnBackgroundRouting(text, taskId, projectIndexes, genIdx);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sendJson(res, 400, { error: 'INVALID_BODY', message: msg });
          }
        });
        return;
      }

      // API: brain dump — LLM task inference via claude CLI
      if (pathname === '/api/capture/braindump' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString()) as { text?: unknown };
            if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
              sendJson(res, 200, { candidates: [], error: 'Could not parse — edit manually' });
              return;
            }
            if (body.text.length > 10_000) {
              sendJson(res, 200, { candidates: [], error: 'Text too long (max 10 000 chars)' });
              return;
            }
            const text = body.text.trim();
            const prefixes = projectIndexes.map(p => p.prefix).join(', ');
            const prompt = `Extract tasks from this text. Return ONLY a valid JSON array, no other text. Each item: {"title":"string","project":"one of ${prefixes} or GEN","area":"client|personal|outsource|internal","why":"optional string"}. Text: ${text}`;

            const result = spawnSync('claude', ['-p', prompt], {
              timeout: 60_000,
              encoding: 'utf-8',
              stdio: ['ignore', 'pipe', 'ignore'],
            });

            if (result.error || result.status !== 0 || !result.stdout) {
              sendJson(res, 200, { candidates: [], error: 'Could not parse — edit manually' });
              return;
            }

            const raw = result.stdout.trim();
            // Extract JSON array from output (claude may emit markdown fences)
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
              sendJson(res, 200, { candidates: [], error: 'Could not parse — edit manually' });
              return;
            }

            interface RawCandidate {
              title?: unknown;
              project?: unknown;
              area?: unknown;
              why?: unknown;
            }

            interface Candidate {
              title: string;
              project: string;
              area: 'client' | 'personal' | 'outsource' | 'internal';
              why?: string;
            }

            const VALID_AREAS = new Set(['client', 'personal', 'outsource', 'internal']);

            let parsed: RawCandidate[];
            try {
              parsed = JSON.parse(jsonMatch[0]) as RawCandidate[];
            } catch {
              sendJson(res, 200, { candidates: [], error: 'Could not parse — edit manually' });
              return;
            }

            if (!Array.isArray(parsed)) {
              sendJson(res, 200, { candidates: [], error: 'Could not parse — edit manually' });
              return;
            }

            const candidates: Candidate[] = parsed
              .filter((c): c is RawCandidate => typeof c === 'object' && c !== null && typeof c.title === 'string')
              .map(c => ({
                title: String(c.title),
                project: typeof c.project === 'string' ? c.project : 'GEN',
                area: VALID_AREAS.has(String(c.area)) ? String(c.area) as Candidate['area'] : 'internal',
                ...(c.why && typeof c.why === 'string' ? { why: c.why } : {}),
              }));

            sendJson(res, 200, { candidates });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sendJson(res, 200, { candidates: [], error: msg });
          }
        });
        return;
      }

      // API: commit brain dump candidates as tasks
      if (pathname === '/api/capture/commit' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            interface CommitCandidate {
              title: string;
              project: string;
              area?: string;
              why?: string;
            }
            const body = JSON.parse(Buffer.concat(chunks).toString()) as { candidates?: CommitCandidate[] };
            if (!body.candidates || !Array.isArray(body.candidates)) {
              sendJson(res, 400, { error: 'MISSING_FIELDS', message: 'candidates array is required' });
              return;
            }

            const created: string[] = [];
            const now = new Date().toISOString();

            for (const c of body.candidates) {
              if (!c.title || typeof c.title !== 'string') continue;
              const projectPrefix = typeof c.project === 'string' ? c.project : 'GEN';
              const pIdx = projectIndexes.find(p => p.prefix === projectPrefix)
                ?? projectIndexes.find(p => p.prefix === 'GEN')
                ?? projectIndexes[0];
              if (!pIdx) continue;

              const num = pIdx.index.nextId(pIdx.prefix);
              const id = `${pIdx.prefix}-${String(num).padStart(3, '0')}`;
              const task = {
                schema_version: 1,
                id,
                title: c.title.slice(0, 120),
                type: 'chore' as const,
                status: 'todo' as const,
                priority: 'medium' as const,
                project: pIdx.prefix,
                tags: [],
                complexity: 1,
                complexity_manual: false,
                why: typeof c.why === 'string' ? c.why : '',
                created: now,
                updated: now,
                last_activity: now,
                claimed_by: null,
                claimed_at: null,
                claim_ttl_hours: 4,
                parent: null,
                children: [],
                dependencies: [],
                subtasks: [],
                git: { commits: [] },
                transitions: [],
                files: [],
                body: '',
                file_path: `${id}.md`,
                auto_captured: true,
              };
              pIdx.index.upsertTask(task);
              created.push(id);
            }

            sendJson(res, 200, { created });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sendJson(res, 400, { error: 'INVALID_BODY', message: msg });
          }
        });
        return;
      }

      // API: ACR status (cached, 10s TTL)
      if (pathname === '/api/acr/status' && req.method === 'GET') {
        const now = Date.now();
        if (acrCache && acrCache.expiresAt > now) {
          sendJson(res, 200, acrCache.data);
        } else if (acrCache) {
          // Serve stale cache immediately while triggering background refresh
          const stale = acrCache.data;
          // Background refresh — fire and forget
          fetchAcrStatus().then(fresh => {
            acrCache = { data: fresh, expiresAt: Date.now() + 10_000 };
          }).catch(() => { /* non-fatal */ });
          sendJson(res, 200, stale);
        } else {
          // No cache yet — fetch for first request
          void fetchAcrStatus().then(fresh => {
            acrCache = { data: fresh, expiresAt: Date.now() + 10_000 };
            sendJson(res, 200, fresh);
          }).catch(() => {
            const fallback: AcrStatusResponse = { offline: true, jobs: [] };
            sendJson(res, 200, fallback);
          });
          return;
        }
        return;
      }

      // API: dispatch to ACR via MCP tool call
      if (pathname === '/api/acr/dispatch' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString()) as { title?: unknown; detail?: unknown };
            if (!body.title || typeof body.title !== 'string') {
              sendJson(res, 400, { error: 'MISSING_FIELDS', message: 'title is required' });
              return;
            }
            const title = String(body.title);
            const detail = typeof body.detail === 'string' ? body.detail : '';

            const rpcBody = JSON.stringify({
              jsonrpc: '2.0',
              method: 'tools/call',
              params: {
                name: 'acr_create_job',
                arguments: { title, detail },
              },
              id: 1,
            });

            try {
              const acrRes = await fetch('http://localhost:3001/mcp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: rpcBody,
                signal: AbortSignal.timeout(5000),
              });
              const data = await acrRes.json() as { result?: { jobId?: string }; id?: unknown };
              const jobId = (data.result as Record<string, unknown> | undefined)?.jobId;
              sendJson(res, 200, { jobId: jobId ?? 'dispatched' });
            } catch (fetchErr) {
              // ECONNREFUSED, timeout, or any network error — ACR is offline
              sendJson(res, 200, { error: 'ACR offline' });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sendJson(res, 400, { error: 'INVALID_BODY', message: msg });
          }
        });
        return;
      }

      // API: brain search — proxies brain MCP bridge (BRAIN_MCP_URL, default localhost:8093)
      // POST to {BRAIN_MCP_URL}/mcp using JSON-RPC 2.0 tools/call for brain_search tool
      if (pathname === '/api/brain/search' && req.method === 'GET') {
        const q = url.searchParams.get('q') ?? '';
        if (!q || q.trim().length === 0) {
          sendError(res, 400, 'q parameter is required and must not be empty');
          return;
        }
        if (q.length > 500) {
          sendError(res, 400, 'q parameter must be 500 characters or fewer');
          return;
        }
        void fetchBrainSearch(q.trim()).then(result => {
          sendJson(res, 200, result);
        }).catch(() => {
          sendJson(res, 200, { results: [], query: q, offline: true });
        });
        return;
      }

      // API: artifacts list
      if (pathname === '/api/artifacts' && req.method === 'GET') {
        try {
          const entries = readArtifacts();
          sendJson(res, 200, entries);
        } catch {
          sendJson(res, 200, []);
        }
        return;
      }

      // API: mark artifact opened
      if (pathname === '/api/artifacts/opened' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString()) as { path?: unknown };
            if (!body.path || typeof body.path !== 'string') {
              sendJson(res, 400, { error: 'MISSING_FIELDS', message: 'path is required' });
              return;
            }
            const store = loadOpenedStore();
            store[body.path] = new Date().toISOString();
            openedStore = store;
            saveOpenedStore(store);
            sendJson(res, 200, { ok: true });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sendJson(res, 400, { error: 'INVALID_BODY', message: msg });
          }
        });
        return;
      }

      sendError(res, 404, `Unknown route: ${pathname}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendError(res, 500, message);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(opts.port, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : opts.port;
  const url = `http://localhost:${port}`;

  if (opts.openBrowser) {
    const { exec } = await import('node:child_process');
    const openCmd = process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
    exec(openCmd);
  }

  return {
    url,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(err => {
        // Close all DB connections to release file locks (important on Windows)
        for (const p of projectIndexes) {
          try { p.index.close(); } catch { /* ignore */ }
        }
        if (err) reject(err);
        else resolve();
      });
    }),
  };
}
