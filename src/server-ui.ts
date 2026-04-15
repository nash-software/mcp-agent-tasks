import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

export async function startUiServer(opts: { port: number; openBrowser?: boolean }): Promise<UiServerHandle> {
  const config = loadConfig();
  const dbPath = getDbPath();
  const sqliteIndex = new SqliteIndex(dbPath);
  sqliteIndex.init();
  const milestoneRepo = new MilestoneRepository(sqliteIndex.getRawDb());

  const htmlPath = join(__dirname, '..', 'dist', 'ui.html');
  const htmlFallback = join(__dirname, 'ui', 'index.html');

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const pathname = url.pathname;

    try {
      // Serve HTML dashboard
      if (pathname === '/' || pathname === '/index.html') {
        let htmlContent: string | undefined;
        if (existsSync(htmlPath)) {
          htmlContent = readFileSync(htmlPath, 'utf-8');
        } else if (existsSync(htmlFallback)) {
          htmlContent = readFileSync(htmlFallback, 'utf-8');
        }
        if (htmlContent !== undefined) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(htmlContent);
        } else {
          sendError(res, 404, 'Dashboard HTML not found. Run npm run build first.');
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
