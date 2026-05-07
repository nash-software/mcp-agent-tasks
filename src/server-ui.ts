import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, getDbPath, DEFAULT_TASKS_DIR_NAME } from './config/loader.js';
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

interface ProjectIndex {
  prefix: string;
  index: SqliteIndex;
  milestoneRepo: MilestoneRepository;
}

function openProjectIndexes(config: ReturnType<typeof loadConfig>): ProjectIndex[] {
  const tasksDirName = config.tasksDirName ?? DEFAULT_TASKS_DIR_NAME;

  if (config.projects.length === 0) {
    // No registered projects — fall back to global DB
    const idx = new SqliteIndex(getDbPath());
    idx.init();
    return [{ prefix: 'default', index: idx, milestoneRepo: new MilestoneRepository(idx.getRawDb()) }];
  }

  return config.projects.map(p => {
    const tasksDir = join(p.path, tasksDirName);
    const dbPath = existsSync(tasksDir) ? join(tasksDir, '.index.db') : getDbPath();
    const idx = new SqliteIndex(dbPath);
    idx.init();
    return { prefix: p.prefix, index: idx, milestoneRepo: new MilestoneRepository(idx.getRawDb()) };
  });
}

export async function startUiServer(opts: { port: number; openBrowser?: boolean }): Promise<UiServerHandle> {
  const config = loadConfig();
  const projectIndexes = openProjectIndexes(config);

  const uiDir = join(__dirname, '..', 'dist', 'ui');

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const pathname = url.pathname;

    try {
      // Static assets — /assets/* (guard against path traversal)
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

      // API: tasks
      if (pathname === '/api/tasks') {
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

      // API: milestones
      if (pathname === '/api/milestones') {
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

      // API: promote draft → todo
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
