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
import { loadConfig, resolveServerDbPath, DEFAULT_TASKS_DIR_NAME, GLOBAL_CONFIG_PATH } from './config/loader.js';
import { SqliteIndex } from './store/sqlite-index.js';
import { MarkdownStore } from './store/markdown-store.js';
import { ManifestWriter } from './store/manifest-writer.js';
import { TaskStore } from './store/task-store.js';
import { Reconciler } from './store/reconciler.js';

// Extended update type to carry git link fields through the update path
interface UpdateWithGit extends TaskUpdateInput {
  git?: GitLink;
}

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── helpers ──────────────────────────────────────────────────────────────────

function buildStore(tasksDir: string, project: string, config?: import('./config/loader.js').McpTasksConfig) {
  const resolvedConfig = config ?? loadConfig();
  const dbPath = resolveServerDbPath(tasksDir, resolvedConfig, project !== 'DEFAULT' ? project : undefined);
  const sqliteIndex = new SqliteIndex(dbPath);
  sqliteIndex.init();
  const markdownStore = new MarkdownStore();
  const manifestWriter = new ManifestWriter();
  const store = new TaskStore(markdownStore, sqliteIndex, manifestWriter, tasksDir, project);
  return { store, sqliteIndex, markdownStore, manifestWriter };
}

function resolveTasksDir(optPath?: string, prefix?: string): { tasksDir: string; project: string; config: import('./config/loader.js').McpTasksConfig } {
  const config = loadConfig();
  const dirName = config.tasksDirName;

  // Explicit path override — used by --path flag
  if (optPath) {
    const tasksDir = path.join(optPath, dirName);
    // Try to find a matching project for the path
    const matched = config.projects.find(p =>
      path.resolve(p.path) === path.resolve(optPath)
    );
    const project = matched?.prefix ?? config.projects[0]?.prefix ?? 'UNKNOWN';
    return { tasksDir, project, config };
  }

  // Explicit prefix supplied (from --project flag)
  if (prefix) {
    const entry = config.projects.find(p => p.prefix === prefix);
    if (!entry) {
      throw new Error(`Project '${prefix}' is not registered in config. Run 'agent-tasks init ${prefix}' first.`);
    }
    const tasksDir = entry.storage === 'global'
      ? config.storageDir
      : path.join(entry.path, dirName);
    return { tasksDir, project: prefix, config };
  }

  // No prefix — try cwd match
  const cwd = process.cwd();
  const cwdMatch = config.projects.find(p =>
    p.path && cwd.startsWith(path.resolve(p.path))
  );
  if (cwdMatch) {
    const tasksDir = cwdMatch.storage === 'global'
      ? config.storageDir
      : path.join(cwdMatch.path, dirName);
    return { tasksDir, project: cwdMatch.prefix, config };
  }

  // Fallback: first project (preserves existing behaviour for single-project setups)
  const first = config.projects[0];
  if (!first) {
    throw new Error('No projects configured. Run agent-tasks init <PREFIX> first.');
  }
  const tasksDir = first.storage === 'global'
    ? config.storageDir
    : path.join(first.path, dirName);
  return { tasksDir, project: first.prefix, config };
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
  .name('agent-tasks')
  .description('File-based task management for AI coding agents')
  .version(pkg.version);

// ── init ──────────────────────────────────────────────────────────────────────

program
  .command('init <prefix>')
  .description('Idempotent project init — creates agent-tasks/ directory and registers project in global config')
  .option('--path <dir>', 'project root directory', process.cwd())
  .option('--storage <mode>', 'local or global', 'local')
  .action(async (prefix: string, options: { path: string; storage: string }) => {
    const globalCfg = loadConfig();
    const dirName = globalCfg.tasksDirName ?? DEFAULT_TASKS_DIR_NAME;
    const rootDir = path.resolve(options.path);
    const tasksDir = path.join(rootDir, dirName);
    const archiveDir = path.join(tasksDir, 'archive');

    if (!fs.existsSync(tasksDir)) fs.mkdirSync(tasksDir, { recursive: true });
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

    // Read the current global config (already loaded above via loadConfig())
    const projects = globalCfg.projects as Array<{ prefix: string; path: string; storage: string }>;
    const existingIdx = projects.findIndex(p => p.prefix === prefix);
    if (existingIdx >= 0) {
      // Update existing entry in-place
      projects[existingIdx] = { prefix, path: rootDir, storage: options.storage };
    } else {
      projects.push({ prefix, path: rootDir, storage: options.storage });
    }

    const configToWrite = {
      ...globalCfg,
      projects,
    };

    // Atomic write: tmp file → rename (same pattern as MarkdownStore)
    const globalConfigDir = path.dirname(GLOBAL_CONFIG_PATH);
    if (!fs.existsSync(globalConfigDir)) fs.mkdirSync(globalConfigDir, { recursive: true });
    const tmp = `${GLOBAL_CONFIG_PATH}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(configToWrite, null, 2), 'utf-8');
    fs.renameSync(tmp, GLOBAL_CONFIG_PATH);

    const globalConfigDisplay = GLOBAL_CONFIG_PATH.replace(os.homedir(), '~');
    console.log(`✓ Initialized project ${prefix} at ${rootDir}`);
    console.log(`  tasks/   → ${tasksDir}`);
    console.log(`  archive/ → ${archiveDir}`);
    console.log(`  config   → ${globalConfigDisplay} (global)`);
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
    const { tasksDir, project } = resolveTasksDir(undefined, options.project);
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
    const { tasksDir, project } = resolveTasksDir(undefined, projectArg);
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
    const tasksDirName = config.tasksDirName ?? DEFAULT_TASKS_DIR_NAME;

    const projectEntries = config.projects.length > 0
      ? config.projects
      : [{ prefix: project, path: path.dirname(tasksDir), storage: 'local' as const }];

    const rows = projectEntries.map(p => {
      const projTasksDir = path.join(p.path, tasksDirName);
      const { sqliteIndex } = buildStore(projTasksDir, p.prefix);
      const todo = sqliteIndex.listTasks({ status: 'todo', project: p.prefix }).length;
      const in_progress = sqliteIndex.listTasks({ status: 'in_progress', project: p.prefix }).length;
      const done = sqliteIndex.listTasks({ status: 'done', project: p.prefix }).length;
      const blocked = sqliteIndex.listTasks({ status: 'blocked', project: p.prefix }).length;
      return { project: p.prefix, todo, in_progress, done, blocked };
    });

    console.log(formatTable(rows));
  });

// ── install-hooks ─────────────────────────────────────────────────────────────

program
  .command('install-hooks')
  .description('Install git hooks globally to ~/.claude/git-hooks/ (default) or locally to .git/hooks/ (--local)')
  .option('--path <dir>', 'project root directory (used with --local)', process.cwd())
  .option('--local', 'install to .git/hooks/ of the target repo instead of the global path', false)
  .option('--global', 'install to ~/.claude/git-hooks/ (default behaviour, explicit flag)', true)
  .action((options: { path: string; local: boolean; global: boolean }) => {
    // Source hooks live next to this file in hooks/ (dist layout) or in project hooks/ (dev)
    const hooksSourceDir = path.join(__dirname, '..', 'hooks');

    if (!options.local) {
      // ── Global install (default) ─────────────────────────────────────────────
      const globalHooksDir = path.join(os.homedir(), '.claude', 'git-hooks');

      if (!fs.existsSync(globalHooksDir)) {
        fs.mkdirSync(globalHooksDir, { recursive: true });
      }

      // Warn if core.hooksPath doesn't point here
      try {
        const configuredPath = execSync('git config --global core.hooksPath', {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const normalizedConfigured = configuredPath.replace(/\\/g, '/').replace(/^\/c\//, 'C:/');
        const normalizedTarget = globalHooksDir.replace(/\\/g, '/');
        if (normalizedConfigured !== normalizedTarget &&
            configuredPath !== globalHooksDir &&
            configuredPath !== globalHooksDir.replace(/\\/g, '/')) {
          console.warn(`⚠  git config --global core.hooksPath is set to: ${configuredPath}`);
          console.warn(`   Expected: ${globalHooksDir}`);
          console.warn(`   Run: git config --global core.hooksPath "${globalHooksDir}"`);
        }
      } catch {
        // core.hooksPath not set at all
        console.warn(`⚠  git config --global core.hooksPath is not set.`);
        console.warn(`   Hooks installed but will not fire until you run:`);
        console.warn(`   git config --global core.hooksPath "${globalHooksDir}"`);
      }

      for (const hookName of ['post-commit', 'post-merge'] as const) {
        const sourceJs = path.join(hooksSourceDir, `${hookName}.js`);

        if (!fs.existsSync(sourceJs)) {
          console.error(`✗ Source hook not found: ${sourceJs}`);
          continue;
        }

        // 1. Copy .js companion file
        const destJs = path.join(globalHooksDir, `${hookName}.js`);
        fs.copyFileSync(sourceJs, destJs);

        // 2. Write shell wrapper
        const destWrapper = path.join(globalHooksDir, hookName);
        // Use forward-slash Unix path in the shebang line (works under MSYS2/Git Bash)
        const unixJsPath = destJs.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => `/${d.toLowerCase()}`);
        const wrapperContent = `#!/bin/sh\nnode "${unixJsPath}" "$@"\n`;
        fs.writeFileSync(destWrapper, wrapperContent, 'utf-8');
        fs.chmodSync(destWrapper, 0o755);

        console.log(`✓ Installed ${hookName} hook (global: ~/.claude/git-hooks/)`);
      }

    } else {
      // ── Local install (--local flag) — original behaviour ────────────────────
      const rootDir = path.resolve(options.path);
      const hooksDir = path.join(rootDir, '.git', 'hooks');

      if (!fs.existsSync(hooksDir)) {
        console.error(`✗ No .git/hooks directory found at ${hooksDir}`);
        process.exit(1);
      }

      for (const hookName of ['post-commit', 'prepare-commit-msg', 'post-merge'] as const) {
        const target = path.join(hooksDir, hookName);
        const source = path.join(hooksSourceDir, `${hookName}.js`);

        if (!fs.existsSync(source)) {
          console.error(`✗ Source hook not found: ${source}`);
          continue;
        }

        const MCP_MARKER = '# agent-tasks';

        if (!fs.existsSync(target)) {
          // Fresh install
          fs.copyFileSync(source, target);
          fs.chmodSync(target, 0o755);
          console.log(`✓ Installed ${hookName} hook`);
        } else {
          const existing = fs.readFileSync(target, 'utf-8');
          if (existing.includes(MCP_MARKER) || existing.includes('mcp-agent-tasks') || existing.includes('agent-tasks')) {
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
            const mcpDest = path.join(dotDir, '10-agent-tasks');
            fs.copyFileSync(source, mcpDest);
            fs.chmodSync(mcpDest, 0o755);

            // Write dispatcher
            const dispatcher = `#!/usr/bin/env node
// agent-tasks dispatcher
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
  .option('--prune-orphans', 'remove index entries whose markdown files no longer exist', false)
  .action((projectArg: string | undefined, options: { path?: string; pruneOrphans?: boolean }) => {
    const { tasksDir, project } = resolveTasksDir(options.path, projectArg);
    const resolvedProject = projectArg ?? project;
    const { sqliteIndex } = buildStore(tasksDir, resolvedProject);
    const reconciler = new Reconciler(sqliteIndex, tasksDir, resolvedProject);
    const count = reconciler.reconcile();
    console.log(`✓ Rebuilt index: ${count} tasks reconciled for project ${resolvedProject}`);
    if (options.pruneOrphans) {
      const pruned = reconciler.pruneOrphans();
      console.log(`✓ Pruned ${pruned} orphaned tasks`);
    }
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
  .description('Link the current branch PR to a task (uses gh CLI, or supply --pr-number to skip gh lookup)')
  .option('--path <dir>', 'project root directory')
  .option('--pr-number <n>', 'PR number (skips gh pr view lookup)')
  .option('--pr-url <url>', 'PR URL')
  .option('--pr-state <state>', 'PR state (open|merged|closed)')
  .option('--merged-at <iso>', 'Merge timestamp (ISO-8601)')
  .option('--pr-title <title>', 'PR title')
  .action((id: string, options: {
    path?: string;
    prNumber?: string;
    prUrl?: string;
    prState?: string;
    mergedAt?: string;
    prTitle?: string;
  }) => {
    const { tasksDir, project } = resolveTasksDir(options.path);
    const { store, sqliteIndex } = buildStore(tasksDir, project);

    let prData: {
      number: number;
      url: string;
      title: string;
      state: string;
      baseRefName: string;
      mergedAt?: string | null;
    };

    if (options.prNumber !== undefined) {
      // Explicit flags supplied — no gh CLI needed
      if (!options.prUrl || !options.prState) {
        console.error('✗ --pr-url and --pr-state are required when --pr-number is provided');
        process.exit(1);
      }
      prData = {
        number: parseInt(options.prNumber, 10),
        url: options.prUrl,
        title: options.prTitle ?? '',
        state: options.prState,
        baseRefName: '',
        mergedAt: options.mergedAt,
      };
    } else {
      try {
        const raw = execSync('gh pr view --json number,url,title,state,baseRefName', { encoding: 'utf-8' });
        prData = JSON.parse(raw) as typeof prData;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`✗ Could not get PR info: ${msg}`);
        process.exit(1);
      }
    }

    try {
      const task = sqliteIndex.getTask(id);
      if (!task) throw new Error(`Task not found: ${id}`);
      const git = task.git ?? { commits: [] };
      const normalizedState = prData.state.toLowerCase() as import('./types/task.js').PRRef['state'];
      const prPayload: UpdateWithGit = {
        id,
        git: {
          ...git,
          pr: {
            number: prData.number,
            url: prData.url,
            title: prData.title,
            state: normalizedState,
            merged_at: prData.mergedAt ?? null,
            base_branch: prData.baseRefName,
          },
        },
      };
      store.updateTask(id, prPayload);

      // Auto-transition to done when the PR was merged
      if (normalizedState === 'merged') {
        const current = sqliteIndex.getTask(id);
        if (current && current.status !== 'done' && current.status !== 'archived') {
          try {
            store.transitionTask(id, 'done', 'PR merged');
          } catch {
            // Transition not valid from current state — skip silently
          }
        }
      }

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

// ── reconcile-legacy ──────────────────────────────────────────────────────────

program
  .command('reconcile-legacy <projectPath>')
  .description('Scan scratchpads/ for legacy plan files and create task files from them')
  .option('--prefix <ID>', 'project ID prefix (default: derived from package.json or dir name)')
  .option('--dry-run', 'preview only; do not write files', false)
  .action(async (projectPath: string, options: { prefix?: string; dryRun: boolean }) => {
    const { reconcileLegacy } = await import('./tools/task-reconcile-legacy.js');
    try {
      const cfg = loadConfig();
      const summary = await reconcileLegacy({
        projectPath,
        idPrefix: options.prefix,
        dryRun: options.dryRun,
        tasksDirName: cfg.tasksDirName,
      });

      if (summary.scanned === 0) {
        console.log('(no legacy scratchpads found)');
        return;
      }

      const rows = summary.results.map(r => ({
        file: r.file,
        id: r.id,
        status: r.status,
        confidence: r.confidence,
        reason: r.reason.slice(0, 40),
      }));
      console.log(formatTable(rows));
      console.log('');
      console.log(`Scanned ${summary.scanned} | Written ${summary.written} | Skipped ${summary.skipped}${summary.dryRun ? ' (dry-run)' : ''}`);

      const errors = summary.results.filter(r => r.error);
      if (errors.length > 0) {
        console.error(`✗ ${errors.length} errors:`);
        for (const e of errors) console.error(`  ${e.file}: ${e.error}`);
        process.exit(1);
      }

      if (!summary.dryRun && summary.written > 0) {
        const { tasksDir } = resolveTasksDir(projectPath);
        const resolvedPrefix = options.prefix ?? summary.results[0]?.id.split('-')[0] ?? 'PROJECT';
        const { sqliteIndex } = buildStore(tasksDir, resolvedPrefix);
        const reconciler = new Reconciler(sqliteIndex, tasksDir, resolvedPrefix);
        const count = reconciler.reconcile();
        console.log(`✓ Rebuilt index: ${count} tasks reconciled`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${msg}`);
      process.exit(1);
    }
  });

// ── audit ─────────────────────────────────────────────────────────────────────

program
  .command('audit <projectPath>')
  .description('Audit in_progress tasks: resolve done via git/GitHub, tag ambiguous ones for review')
  .option('--prefix <ID>', 'project ID prefix (default: derived from package.json or dir name)')
  .option('--dry-run', 'preview only; do not write changes', false)
  .option('--no-llm', 'skip LLM matching, only use git branch lookup')
  .action(async (projectPath: string, options: { prefix?: string; dryRun: boolean; llm: boolean }) => {
    const { auditTasks } = await import('./tools/task-audit.js');
    try {
      const summary = await auditTasks({
        projectPath,
        idPrefix: options.prefix,
        dryRun: options.dryRun,
        noLlm: !options.llm,
      });

      if (summary.scanned === 0) {
        console.log('(no in_progress tasks found)');
        return;
      }

      const rows = summary.results.map(r => ({
        id: r.taskId,
        title: r.title.slice(0, 40),
        action: r.action,
        method: r.method,
        conf: r.confidence,
        pr: r.evidence?.prNumber ? `#${r.evidence.prNumber}` : '',
      }));
      console.log(formatTable(rows));
      console.log('');
      console.log(
        `Scanned ${summary.scanned} | Done ${summary.transitioned} | Review ${summary.taggedReview} | No signal ${summary.noSignal}${summary.dryRun ? ' (dry-run)' : ''}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${msg}`);
      process.exit(1);
    }
  });

// ── setup ─────────────────────────────────────────────────────────────────────

program
  .command('setup')
  .description('One-time global setup: register MCP server in Claude Code and install task-gate hook')
  .option('--dry-run', 'show what would be done without making changes', false)
  .action((options: { dryRun: boolean }) => {
    const log = (msg: string): void => console.log(options.dryRun ? `[dry-run] ${msg}` : `✓ ${msg}`);

    // 1. Find binary path via npm global prefix
    let binaryPath: string;
    try {
      const npmPrefix = execSync('npm prefix -g', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      binaryPath = process.platform === 'win32'
        ? path.join(npmPrefix, 'agent-tasks')
        : path.join(npmPrefix, 'bin', 'agent-tasks');
    } catch {
      console.error('✗ Could not determine npm global prefix. Ensure npm is installed and on PATH.');
      process.exit(1);
    }

    // 2. Register MCP server in ~/.claude.json
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    let claudeJson: Record<string, unknown> = {};
    if (fs.existsSync(claudeJsonPath)) {
      try { claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8')) as Record<string, unknown>; } catch { /* start fresh */ }
    }
    if (!claudeJson['mcpServers']) claudeJson['mcpServers'] = {};
    const mcpServers = claudeJson['mcpServers'] as Record<string, unknown>;
    const wasRegistered = 'agent-tasks' in mcpServers;
    mcpServers['agent-tasks'] = { type: 'stdio', command: binaryPath, args: ['serve'], env: {} };
    if (!options.dryRun) {
      fs.mkdirSync(path.dirname(claudeJsonPath), { recursive: true });
      fs.writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2), 'utf-8');
    }
    log(`${wasRegistered ? 'Updated' : 'Registered'} MCP server in ${claudeJsonPath}`);
    log(`  command: ${binaryPath} serve`);

    // 3. Install task-gate hook
    const hooksSourceDir = path.join(__dirname, '..', 'hooks');
    const taskGateSrc = path.join(hooksSourceDir, 'task-gate.js');
    const taskGateDest = path.join(os.homedir(), '.claude', 'hooks', 'task-gate.js');
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

    if (!fs.existsSync(taskGateSrc)) {
      console.error(`✗ task-gate.js not found at ${taskGateSrc} — is the package installed correctly?`);
      process.exit(1);
    }

    if (!options.dryRun) {
      fs.mkdirSync(path.dirname(taskGateDest), { recursive: true });
      fs.copyFileSync(taskGateSrc, taskGateDest);
      fs.chmodSync(taskGateDest, 0o755);
    }
    log(`Installed task-gate.js → ${taskGateDest}`);

    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>; } catch { /* start fresh */ }
    }
    if (!settings['hooks']) settings['hooks'] = {};
    const hooks = settings['hooks'] as Record<string, unknown>;
    if (!hooks['PreToolUse']) hooks['PreToolUse'] = [];
    const preToolUse = hooks['PreToolUse'] as Array<Record<string, unknown>>;
    const hookEntry = { key: 'task-gate', matcher: '.*', cmd: `node ${taskGateDest}` };
    const existingIdx = preToolUse.findIndex(h => h['key'] === 'task-gate');
    if (existingIdx >= 0) { preToolUse[existingIdx] = hookEntry; } else { preToolUse.push(hookEntry); }
    if (!options.dryRun) {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    }
    log(`Registered task-gate PreToolUse hook in ${settingsPath}`);

    // 4. Create global config + storage dirs
    const configDir = path.join(os.homedir(), '.config', 'mcp-tasks');
    const storageDir = path.join(os.homedir(), '.mcp-tasks', 'tasks');
    if (!options.dryRun) {
      fs.mkdirSync(configDir, { recursive: true });
      fs.mkdirSync(storageDir, { recursive: true });
    }
    log(`Config dir ready: ${configDir}`);
    log(`Storage dir ready: ${storageDir}`);

    // Summary
    console.log('');
    console.log(options.dryRun ? 'Dry-run complete — no changes made.' : 'Setup complete!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Restart Claude Code to load the MCP server');
    console.log('  2. Run /mcp in Claude Code to verify agent-tasks is listed');
    console.log('  3. For each project: cd <project-root> && agent-tasks init <PREFIX>');
    console.log('');
  });

// ── serve-ui ──────────────────────────────────────────────────────────────────

program
  .command('serve-ui')
  .description('Start local dashboard server')
  .option('--port <n>', 'port number', '4242')
  .option('--open', 'open browser after start')
  .action(async (opts: { port: string; open?: boolean }) => {
    const { startUiServer } = await import('./server-ui.js');
    const { url, close } = await startUiServer({ port: parseInt(opts.port, 10), openBrowser: opts.open });
    console.log(`Dashboard: ${url}`);
    process.on('SIGINT', async () => { await close(); process.exit(0); });
  });

// ── add-file ──────────────────────────────────────────────────────────────────

program
  .command('add-file <id> <filePath>')
  .description('Add a file path to a task')
  .option('--path <dir>', 'project root directory')
  .action((id: string, filePath: string, options: { path?: string }) => {
    const { tasksDir, project } = resolveTasksDir(options.path);
    const { store, sqliteIndex } = buildStore(tasksDir, project);
    const task = sqliteIndex.getTask(id);
    if (!task) {
      console.error(`✗ Task not found: ${id}`);
      process.exit(1);
    }
    const existing = task.files ?? [];
    const deduped = Array.from(new Set([...existing, filePath]));
    store.updateTask(id, { id, files: deduped });
    console.log(`✓ Added file ${filePath} to ${id}`);
  });

// ── create ────────────────────────────────────────────────────────────────────

program
  .command('create')
  .description('Create a task')
  .requiredOption('--project <prefix>', 'project prefix')
  .requiredOption('--title <title>', 'task title')
  .requiredOption('--type <type>', 'task type')
  .requiredOption('--why <why>', 'reason for this task')
  .option('--priority <priority>', 'priority', 'medium')
  .option('--auto-captured', 'mark as auto-captured')
  .option('--plan-file <path>', 'link a plan file')
  .option('--milestone <id>', 'milestone ID')
  .option('--estimate-hours <n>', 'estimate hours', parseFloat)
  .action(async (opts: {
    project: string;
    title: string;
    type: string;
    why: string;
    priority: string;
    autoCaptured?: boolean;
    planFile?: string;
    milestone?: string;
    estimateHours?: number;
  }) => {
    const { tasksDir } = resolveTasksDir(undefined, opts.project);
    const { store } = buildStore(tasksDir, opts.project);
    try {
      const task = store.createTask({
        project: opts.project,
        title: opts.title,
        type: opts.type as import('./types/task.js').TaskType,
        priority: opts.priority as import('./types/task.js').Priority,
        why: opts.why,
        auto_captured: opts.autoCaptured,
        plan_file: opts.planFile,
        milestone: opts.milestone,
        estimate_hours: opts.estimateHours,
      });
      process.stdout.write(`${task.id}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${msg}`);
      process.exit(1);
    }
  });

// ── install ───────────────────────────────────────────────────────────────────

function getHookVersion(filePath: string): string {
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').slice(0, 5);
    const vLine = lines.find(l => l.includes('@version'));
    return vLine ? vLine.replace(/.*@version\s*/, '').trim() : '0.0.0';
  } catch { return '0.0.0'; }
}

function semverGt(a: string, b: string): boolean {
  const parse = (v: string): number[] => v.split('.').map(n => parseInt(n, 10) || 0);
  const [a0, a1, a2] = parse(a);
  const [b0, b1, b2] = parse(b);
  if (a0 !== b0) return a0 > b0;
  if (a1 !== b1) return a1 > b1;
  return a2 > b2;
}

program
  .command('install')
  .description('Install agent-tasks globally: MCP server + hooks')
  .option('--dry-run', 'print what would be done without writing')
  .option('--project-dir <dir>', 'also initialise this project dir')
  .option('--prefix <p>', 'project prefix for --project-dir init')
  .action(async (opts: { dryRun?: boolean; projectDir?: string; prefix?: string }) => {
    const dryRun = opts.dryRun ?? false;
    const log = (msg: string): void => console.log(dryRun ? `[dry-run] ${msg}` : `✓ ${msg}`);
    const hooksSourceDir = path.join(__dirname, '..', 'hooks');
    const claudeHooksDir = path.join(os.homedir(), '.claude', 'hooks');
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

    // 1. Register MCP server in ~/.claude.json (reuse setup logic)
    let binaryPath: string;
    try {
      const npmPrefix = execSync('npm prefix -g', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      binaryPath = process.platform === 'win32'
        ? path.join(npmPrefix, 'agent-tasks')
        : path.join(npmPrefix, 'bin', 'agent-tasks');
    } catch {
      console.error('✗ Could not determine npm global prefix.');
      process.exit(1);
    }

    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    let claudeJson: Record<string, unknown> = {};
    if (fs.existsSync(claudeJsonPath)) {
      try { claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8')) as Record<string, unknown>; } catch { /* start fresh */ }
    }
    if (!claudeJson['mcpServers']) claudeJson['mcpServers'] = {};
    const mcpServers = claudeJson['mcpServers'] as Record<string, unknown>;
    mcpServers['agent-tasks'] = { type: 'stdio', command: binaryPath, args: ['serve'], env: {} };
    if (!dryRun) {
      fs.mkdirSync(path.dirname(claudeJsonPath), { recursive: true });
      fs.writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2), 'utf-8');
    }
    log(`Registered MCP server in ${claudeJsonPath}`);

    // Load or bootstrap settings.json
    let settings: { hooks: { PostToolUse: Array<Record<string, unknown>>; SessionStart: Array<Record<string, unknown>> } } = { hooks: { PostToolUse: [], SessionStart: [] } };
    if (fs.existsSync(settingsPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
        if (!raw['hooks']) raw['hooks'] = {};
        const h = raw['hooks'] as Record<string, unknown>;
        if (!h['PostToolUse']) h['PostToolUse'] = [];
        if (!h['SessionStart']) h['SessionStart'] = [];
        settings = raw as typeof settings;
      } catch { /* use defaults */ }
    }

    // Helper: dedup hook entry by filename in cmd
    function upsertHookEntry(
      arr: Array<Record<string, unknown>>,
      entry: Record<string, unknown>,
      filename: string,
    ): void {
      const idx = arr.findIndex(h => typeof h['cmd'] === 'string' && (h['cmd'] as string).includes(filename));
      if (idx >= 0) { arr[idx] = entry; } else { arr.push(entry); }
    }

    // 2. Copy passive-capture.js → ~/.claude/hooks/ (version-aware)
    const passiveSrc = path.join(hooksSourceDir, 'passive-capture.js');
    const passiveDest = path.join(claudeHooksDir, 'passive-capture.js');
    if (fs.existsSync(passiveSrc)) {
      const srcVersion = getHookVersion(passiveSrc);
      const destVersion = getHookVersion(passiveDest);
      if (!fs.existsSync(passiveDest) || semverGt(srcVersion, destVersion)) {
        if (!dryRun) {
          fs.mkdirSync(claudeHooksDir, { recursive: true });
          fs.copyFileSync(passiveSrc, passiveDest);
        }
        log(`Installed passive-capture.js ${srcVersion} → ${passiveDest}`);
      } else {
        log(`passive-capture.js already up to date (${destVersion})`);
      }

      // 3. Add PostToolUse entry
      const postEntry: Record<string, unknown> = {
        key: 'passive-capture',
        matcher: '.*',
        cmd: `node ${passiveDest}`,
      };
      upsertHookEntry(settings.hooks.PostToolUse, postEntry, 'passive-capture.js');
    } else {
      console.error(`✗ passive-capture.js not found at ${passiveSrc}`);
    }

    // 4. Copy session-task-detector.js → ~/.claude/hooks/
    const detectorSrc = path.join(hooksSourceDir, 'session-task-detector.js');
    const detectorDest = path.join(claudeHooksDir, 'session-task-detector.js');
    if (fs.existsSync(detectorSrc)) {
      const srcVersion = getHookVersion(detectorSrc);
      const destVersion = getHookVersion(detectorDest);
      if (!fs.existsSync(detectorDest) || semverGt(srcVersion, destVersion)) {
        if (!dryRun) {
          fs.mkdirSync(claudeHooksDir, { recursive: true });
          fs.copyFileSync(detectorSrc, detectorDest);
        }
        log(`Installed session-task-detector.js ${srcVersion} → ${detectorDest}`);
      } else {
        log(`session-task-detector.js already up to date (${destVersion})`);
      }

      // 5. Add SessionStart entry
      const sessionEntry: Record<string, unknown> = {
        key: 'session-task-detector',
        cmd: `node ${detectorDest}`,
      };
      upsertHookEntry(settings.hooks.SessionStart, sessionEntry, 'session-task-detector.js');
    } else {
      console.error(`✗ session-task-detector.js not found at ${detectorSrc}`);
    }

    if (!dryRun) {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    }
    log(`Updated hooks in ${settingsPath}`);

    // 6. If --project-dir: init that project
    if (opts.projectDir && opts.prefix) {
      const { reconcileLegacy } = await import('./tools/task-reconcile-legacy.js');
      void reconcileLegacy; // optional: just init the dir
      const cfg = loadConfig();
      const projectTasksDir = path.join(opts.projectDir, cfg.tasksDirName);
      if (!dryRun) {
        fs.mkdirSync(projectTasksDir, { recursive: true });
      }
      log(`Initialised project dir: ${projectTasksDir} (prefix: ${opts.prefix})`);
    }

    console.log('');
    console.log(dryRun ? 'Dry-run complete — no changes made.' : 'Install complete!');
  });

// ── parse ─────────────────────────────────────────────────────────────────────

program.parse(process.argv);
