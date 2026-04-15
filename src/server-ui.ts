import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, getDbPath } from './config/loader.js';
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

export async function startUiServer(opts: { port: number; openBrowser?: boolean }): Promise<UiServerHandle> {
  const config = loadConfig();
  const dbPath = getDbPath();
  const sqliteIndex = new SqliteIndex(dbPath);
  sqliteIndex.init();
  const milestoneRepo = new MilestoneRepository(sqliteIndex.getRawDb());

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
        const project = url.searchParams.get('project') ?? undefined;
        const status = url.searchParams.get('status') ?? undefined;
        const milestone = url.searchParams.get('milestone') ?? undefined;
        const label = url.searchParams.get('label') ?? undefined;

        let tasks = sqliteIndex.listTasks({
          project: project,
          status: status as Parameters<typeof sqliteIndex.listTasks>[0]['status'],
          limit: 1000,
        });

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
        const milestones = milestoneRepo.listMilestones();
        sendJson(res, 200, milestones);
        return;
      }

      // API: stats
      if (pathname === '/api/stats') {
        const projects = config.projects.length > 0
          ? config.projects.map(p => p.prefix)
          : [undefined];
        const statsResult = projects.map(p => ({
          project: p ?? 'default',
          stats: sqliteIndex.getStats(p),
        }));
        sendJson(res, 200, statsResult);
        return;
      }

      // API: activity
      if (pathname === '/api/activity') {
        const activity: ActivityEntry[] = sqliteIndex.getRecentActivity(50);
        sendJson(res, 200, activity);
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
        // Close the DB connection to release file locks (important on Windows)
        try { sqliteIndex.close(); } catch { /* ignore */ }
        if (err) reject(err);
        else resolve();
      });
    }),
  };
}
