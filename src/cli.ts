#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import type { GitLink } from './types/task.js';
import type { TaskUpdateInput } from './types/tools.js';

// Extended update type to carry git link fields through the update path
interface UpdateWithGit extends TaskUpdateInput {
  git?: GitLink;
}

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── helpers ──────────────────────────────────────────────────────────────────

function buildStore(tasksDir: string, project: string) {
  // Lazy dynamic imports so commands that don't need a store are fast
  const { SqliteIndex } = require('./store/sqlite-index.js') as typeof import('./store/sqlite-index.js');
  const { MarkdownStore } = require('./store/markdown-store.js') as typeof import('./store/markdown-store.js');
  const { ManifestWriter } = require('./store/manifest-writer.js') as typeof import('./store/manifest-writer.js');
  const { TaskStore } = require('./store/task-store.js') as typeof import('./store/task-store.js');
  const { getDbPath } = require('./config/loader.js') as typeof import('./config/loader.js');

  const dbPath = getDbPath();
  const sqliteIndex = new SqliteIndex(dbPath);
  sqliteIndex.init();
  const markdownStore = new MarkdownStore();
  const manifestWriter = new ManifestWriter();
  const store = new TaskStore(markdownStore, sqliteIndex, manifestWriter, tasksDir, project);
  return { store, sqliteIndex, markdownStore, manifestWriter };
}

function resolveTasksDir(optPath?: string): { tasksDir: string; project: string; config: import('./config/loader.js').McpTasksConfig } {
  const { loadConfig } = require('./config/loader.js') as typeof import('./config/loader.js');
  const config = loadConfig();

  if (optPath) {
    const tasksDir = path.join(optPath, 'tasks');
    const project = config.projects[0]?.prefix ?? 'DEFAULT';
    return { tasksDir, project, config };
  }

  const project = config.projects[0]?.prefix ?? 'DEFAULT';
  const tasksDir = config.projects[0]?.path
    ? path.join(config.projects[0].path, 'tasks')
    : config.storageDir;
  return { tasksDir, project, config };
}

function formatTable(rows: Array<Record<string, string | number | null>>): string {
  if (rows.length === 0) return '(no results)';
  const keys = Object.keys(rows[0]!);
  const widths = keys.map(k => Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length)));
  const header = keys.map((k, i) => k.padEnd(widths[i]!)).join('  ');
  const sep = widths.map(w => '-'.repeat(w)).join('  ');
  const body = rows.map(r => keys.map((k, i) => String(r[k] ?? '').padEnd(widths[i]!)).join('  ')).join('\n');
  return [header, sep, body].join('\n');
}

// ── program ───────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('mcp-agent-tasks')
  .description('File-based task management for AI coding agents')
  .version(pkg.version);

// ── init ──────────────────────────────────────────────────────────────────────

program
  .command('init <prefix>')
  .description('Idempotent project init — creates tasks/ directory and .mcp-tasks.json')
  .option('--path <dir>', 'project root directory', process.cwd())
  .option('--storage <mode>', 'local or global', 'local')
  .action((prefix: string, options: { path: string; storage: string }) => {
    const rootDir = path.resolve(options.path);
    const tasksDir = path.join(rootDir, 'tasks');
    const archiveDir = path.join(tasksDir, 'archive');
    const configFile = path.join(rootDir, '.mcp-tasks.json');

    if (!fs.existsSync(tasksDir)) fs.mkdirSync(tasksDir, { recursive: true });
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

    const { loadConfig } = require('./config/loader.js') as typeof import('./config/loader.js');
    const existingConfig = fs.existsSync(configFile)
      ? (JSON.parse(fs.readFileSync(configFile, 'utf-8')) as Record<string, unknown>)
      : null;

    const config = existingConfig ?? loadConfig();
    const projects = (Array.isArray((config as Record<string, unknown>)['projects'])
      ? (config as Record<string, unknown>)['projects']
      : []) as Array<{ prefix: string; path: string; storage: string }>;

    if (!projects.find(p => p.prefix === prefix)) {
      projects.push({ prefix, path: rootDir, storage: options.storage });
    }

    const configToWrite = {
      ...(config as Record<string, unknown>),
      projects,
    };

    fs.writeFileSync(configFile, JSON.stringify(configToWrite, null, 2), 'utf-8');
    console.log(`✓ Initialized project ${prefix} at ${rootDir}`);
    console.log(`  tasks/   → ${tasksDir}`);
    console.log(`  archive/ → ${archiveDir}`);
    console.log(`  config   → ${configFile}`);
  });

// ── serve ─────────────────────────────────────────────────────────────────────

program
  .command('serve')
  .description('Start MCP stdio server')
  .action(async () => {
    // server.ts runs as main — just import and execute it
    // We re-exec as a subprocess pointing at the server entry so it can own stdio cleanly
    const { execFileSync } = require('child_process') as typeof import('child_process');
    const serverEntry = path.join(__dirname, 'server.js');
    if (!fs.existsSync(serverEntry)) {
      // In dev/ts-node mode, fall back to dynamic import
      await import('./server.js');
      return;
    }
    execFileSync(process.execPath, [serverEntry], { stdio: 'inherit' });
  });

// ── list ──────────────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List tasks')
  .option('--status <s>', 'filter by status')
  .option('--project <p>', 'filter by project prefix')
  .option('--limit <n>', 'max results', '50')
  .option('--format <fmt>', 'table or json', 'table')
  .action((options: { status?: string; project?: string; limit: string; format: string }) => {
    const { tasksDir, project } = resolveTasksDir();
    const { sqliteIndex } = buildStore(tasksDir, project);
    const tasks = sqliteIndex.listTasks({
      status: options.status as import('./types/task.js').TaskStatus | undefined,
      project: options.project,
      limit: parseInt(options.limit, 10),
    });

    if (options.format === 'json') {
      console.log(JSON.stringify(tasks, null, 2));
      return;
    }

    const rows = tasks.map(t => ({
      id: t.id,
      title: t.title.slice(0, 40),
      status: t.status,
      priority: t.priority,
      project: t.project,
    }));
    console.log(formatTable(rows));
  });

// ── next ──────────────────────────────────────────────────────────────────────

program
  .command('next <project>')
  .description('Get the next task for a project')
  .action((projectArg: string) => {
    const { tasksDir, project } = resolveTasksDir();
    const { sqliteIndex } = buildStore(tasksDir, project);
    const task = sqliteIndex.getNextTask(projectArg);
    if (!task) {
      console.log('No tasks available');
      process.exit(0);
    }
    console.log(`${task.id}: ${task.title}`);
  });

// ── status ────────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Cross-project summary')
  .action(() => {
    const { config, tasksDir, project } = resolveTasksDir();
    const { sqliteIndex } = buildStore(tasksDir, project);

    const projects = config.projects.length > 0
      ? config.projects.map(p => p.prefix)
      : [project];

    const rows = projects.map(p => {
      const todo = sqliteIndex.listTasks({ status: 'todo', project: p }).length;
      const in_progress = sqliteIndex.listTasks({ status: 'in_progress', project: p }).length;
      const done = sqliteIndex.listTasks({ status: 'done', project: p }).length;
      const blocked = sqliteIndex.listTasks({ status: 'blocked', project: p }).length;
      return { project: p, todo, in_progress, done, blocked };
    });

    console.log(formatTable(rows));
  });

// ── install-hooks ─────────────────────────────────────────────────────────────

program
  .command('install-hooks')
  .description('Install git hooks (post-commit, prepare-commit-msg)')
  .option('--path <dir>', 'project root directory', process.cwd())
  .action((options: { path: string }) => {
    const rootDir = path.resolve(options.path);
    const hooksDir = path.join(rootDir, '.git', 'hooks');

    if (!fs.existsSync(hooksDir)) {
      console.error(`✗ No .git/hooks directory found at ${hooksDir}`);
      process.exit(1);
    }

    // Source hooks live next to this file in hooks/ (dist layout) or in project hooks/ (dev)
    const hooksSourceDir = path.join(__dirname, '..', 'hooks');

    for (const hookName of ['post-commit', 'prepare-commit-msg'] as const) {
      const target = path.join(hooksDir, hookName);
      const source = path.join(hooksSourceDir, `${hookName}.js`);

      if (!fs.existsSync(source)) {
        console.error(`✗ Source hook not found: ${source}`);
        continue;
      }

      const MCP_MARKER = '# mcp-agent-tasks';

      if (!fs.existsSync(target)) {
        // Fresh install
        fs.copyFileSync(source, target);
        fs.chmodSync(target, 0o755);
        console.log(`✓ Installed ${hookName} hook`);
      } else {
        const existing = fs.readFileSync(target, 'utf-8');
        if (existing.includes(MCP_MARKER) || existing.includes('mcp-agent-tasks')) {
          // Overwrite our own hook
          fs.copyFileSync(source, target);
          fs.chmodSync(target, 0o755);
          console.log(`✓ Updated ${hookName} hook`);
        } else {
          // Chain with user hook
          const dotDir = path.join(hooksDir, `${hookName}.d`);
          if (!fs.existsSync(dotDir)) fs.mkdirSync(dotDir, { recursive: true });

          // Move existing to 00-existing
          const existingDest = path.join(dotDir, '00-existing');
          if (!fs.existsSync(existingDest)) {
            fs.renameSync(target, existingDest);
            fs.chmodSync(existingDest, 0o755);
          }

          // Copy mcp hook
          const mcpDest = path.join(dotDir, '10-mcp-agent-tasks');
          fs.copyFileSync(source, mcpDest);
          fs.chmodSync(mcpDest, 0o755);

          // Write dispatcher
          const dispatcher = `#!/usr/bin/env node
// mcp-agent-tasks dispatcher
const fs = require('fs'); const path = require('path'); const {execFileSync} = require('child_process');
const d = path.join(__dirname, path.basename(__filename) + '.d');
if (!fs.existsSync(d)) process.exit(0);
for (const f of fs.readdirSync(d).sort()) {
  try { execFileSync(path.join(d, f), process.argv.slice(2), {stdio: 'inherit', env: process.env}); }
  catch (e) { process.exit((e.status) || 1); }
}
`;
          fs.writeFileSync(target, dispatcher, 'utf-8');
          fs.chmodSync(target, 0o755);
          console.log(`✓ Installed ${hookName} hook (chained with existing hook in ${hookName}.d/)`);
        }
      }
    }
  });

// ── install-claude-hooks ──────────────────────────────────────────────────────

program
  .command('install-claude-hooks')
  .description('Install task-gate hook for Claude Code')
  .action(() => {
    const hooksSourceDir = path.join(__dirname, '..', 'hooks');
    const source = path.join(hooksSourceDir, 'task-gate.js');
    const dest = path.join(os.homedir(), '.claude', 'hooks', 'task-gate.js');
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

    // Ensure dest dir exists
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    if (!fs.existsSync(source)) {
      console.error(`✗ Source hook not found: ${source}`);
      process.exit(1);
    }

    fs.copyFileSync(source, dest);
    fs.chmodSync(dest, 0o755);
    console.log(`✓ Copied task-gate.js to ${dest}`);

    // Update settings.json
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
      } catch {
        settings = {};
      }
    }

    if (!settings['hooks']) settings['hooks'] = {};
    const hooks = settings['hooks'] as Record<string, unknown>;
    if (!hooks['PreToolUse']) hooks['PreToolUse'] = [];
    const preToolUse = hooks['PreToolUse'] as Array<Record<string, unknown>>;

    const hookEntry = {
      key: 'task-gate',
      matcher: '.*',
      cmd: `node ${dest}`,
    };

    const existingIdx = preToolUse.findIndex(h => h['key'] === 'task-gate');
    if (existingIdx >= 0) {
      preToolUse[existingIdx] = hookEntry;
    } else {
      preToolUse.push(hookEntry);
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    console.log(`✓ Registered task-gate hook in ${settingsPath}`);
  });

// ── rebuild-index ─────────────────────────────────────────────────────────────

program
  .command('rebuild-index [project]')
  .description('Rebuild SQLite index from markdown files')
  .option('--path <dir>', 'project root directory')
  .action((projectArg: string | undefined, options: { path?: string }) => {
    const { tasksDir, project } = resolveTasksDir(options.path);
    const resolvedProject = projectArg ?? project;
    const { sqliteIndex } = buildStore(tasksDir, resolvedProject);
    const { Reconciler } = require('./store/reconciler.js') as typeof import('./store/reconciler.js');
    const reconciler = new Reconciler(sqliteIndex, tasksDir, resolvedProject);
    const count = reconciler.reconcile();
    console.log(`✓ Rebuilt index: ${count} tasks reconciled for project ${resolvedProject}`);
  });

// ── archive ───────────────────────────────────────────────────────────────────

program
  .command('archive <id>')
  .description('Archive a task')
  .option('--path <dir>', 'project root directory')
  .action((id: string, options: { path?: string }) => {
    const { tasksDir, project } = resolveTasksDir(options.path);
    const { store } = buildStore(tasksDir, project);
    store.archiveTask(id);
    console.log(`✓ Archived task ${id}`);
  });

// ── link-commit ───────────────────────────────────────────────────────────────

program
  .command('link-commit <id> <sha> <message>')
  .description('Link a git commit to a task')
  .option('--path <dir>', 'project root directory')
  .action((id: string, sha: string, message: string, options: { path?: string }) => {
    const { tasksDir, project } = resolveTasksDir(options.path);
    const { store, sqliteIndex } = buildStore(tasksDir, project);
    try {
      const task = sqliteIndex.getTask(id);
      if (!task) throw new Error(`Task not found: ${id}`);
      const git = task.git ?? { commits: [] };
      const commits = [...git.commits, { sha, message, authored_at: new Date().toISOString() }];
      const updatePayload: UpdateWithGit = { id, git: { ...git, commits } };
      store.updateTask(id, updatePayload);
      console.log(`✓ Linked commit ${sha} to ${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${msg}`);
      process.exit(1);
    }
  });

// ── link-pr ───────────────────────────────────────────────────────────────────

program
  .command('link-pr <id>')
  .description('Link the current branch PR to a task (uses gh CLI)')
  .option('--path <dir>', 'project root directory')
  .action((id: string, options: { path?: string }) => {
    const { tasksDir, project } = resolveTasksDir(options.path);
    const { store, sqliteIndex } = buildStore(tasksDir, project);

    let prData: {
      number: number;
      url: string;
      title: string;
      state: string;
      baseRefName: string;
    };

    try {
      const raw = execSync('gh pr view --json number,url,title,state,baseRefName', { encoding: 'utf-8' });
      prData = JSON.parse(raw) as typeof prData;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ Could not get PR info: ${msg}`);
      process.exit(1);
    }

    try {
      const task = sqliteIndex.getTask(id);
      if (!task) throw new Error(`Task not found: ${id}`);
      const git = task.git ?? { commits: [] };
      const prPayload: UpdateWithGit = {
        id,
        git: {
          ...git,
          pr: {
            number: prData.number,
            url: prData.url,
            title: prData.title,
            state: prData.state as import('./types/task.js').PRRef['state'],
            merged_at: null,
            base_branch: prData.baseRefName,
          },
        },
      };
      store.updateTask(id, prPayload);
      console.log(`✓ Linked PR #${prData.number} to ${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${msg}`);
      process.exit(1);
    }
  });

// ── migrate ───────────────────────────────────────────────────────────────────

program
  .command('migrate [project]')
  .description('Run schema migrations (stub)')
  .action((_project: string | undefined) => {
    console.log('Migration not needed for schema_version 1');
  });

// ── parse ─────────────────────────────────────────────────────────────────────

program.parse(process.argv);
