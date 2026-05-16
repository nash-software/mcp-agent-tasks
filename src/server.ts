import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, GLOBAL_CONFIG_PATH } from './config/loader.js';
import { SqliteIndex } from './store/sqlite-index.js';
import { MarkdownStore } from './store/markdown-store.js';
import { ManifestWriter } from './store/manifest-writer.js';
import { StoreRegistry } from './store/store-registry.js';
import { Reconciler } from './store/reconciler.js';
import { FileWatcher } from './store/file-watcher.js';
import { MilestoneRepository } from './store/milestone-repository.js';
import { McpTasksError } from './types/errors.js';
import type { ToolContext } from './tools/context.js';

// Tool modules
import * as taskCreate from './tools/task-create.js';
import * as taskUpdate from './tools/task-update.js';
import * as taskGet from './tools/task-get.js';
import * as taskList from './tools/task-list.js';
import * as taskDelete from './tools/task-delete.js';
import * as taskSearch from './tools/task-search.js';
import * as taskNext from './tools/task-next.js';
import * as taskClaim from './tools/task-claim.js';
import * as taskRelease from './tools/task-release.js';
import * as taskTransition from './tools/task-transition.js';
import * as taskAddSubtask from './tools/task-add-subtask.js';
import * as taskPromoteSubtask from './tools/task-promote-subtask.js';
import * as taskLinkCommit from './tools/task-link-commit.js';
import * as taskLinkPr from './tools/task-link-pr.js';
import * as taskLinkBranch from './tools/task-link-branch.js';
import * as taskBlockedBy from './tools/task-blocked-by.js';
import * as taskUnblocks from './tools/task-unblocks.js';
import * as taskStale from './tools/task-stale.js';
import * as taskStats from './tools/task-stats.js';
import * as taskInit from './tools/task-init.js';
import * as taskRebuildIndex from './tools/task-rebuild-index.js';
import * as taskRegisterProject from './tools/task-register-project.js';
import * as taskReconcileLegacy from './tools/task-reconcile-legacy.js';
import * as taskMilestone from './tools/task-milestone.js';

// Package version — imported as JSON
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

interface ToolModule {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  validate(input: unknown): void;
  execute(input: unknown, ctx: ToolContext): Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

const TOOLS: ToolModule[] = [
  taskCreate,
  taskUpdate,
  taskGet,
  taskList,
  taskDelete,
  taskSearch,
  taskNext,
  taskClaim,
  taskRelease,
  taskTransition,
  taskAddSubtask,
  taskPromoteSubtask,
  taskLinkCommit,
  taskLinkPr,
  taskLinkBranch,
  taskBlockedBy,
  taskUnblocks,
  taskStale,
  taskStats,
  taskInit,
  taskRebuildIndex,
  taskRegisterProject,
  taskReconcileLegacy,
  taskMilestone,
];

const TOOL_MAP = new Map<string, ToolModule>(TOOLS.map(t => [t.name, t]));

async function main(): Promise<void> {
  // Session ID unique to this server process
  const sessionId = `${os.hostname().replace(/[^a-zA-Z0-9]/g, '-')}-${process.pid}-${Date.now()}`;

  const config = loadConfig();

  // One shared SqliteIndex at global storageDir
  const dbPath = path.join(config.storageDir, '.index.db');
  const sqliteIndex = new SqliteIndex(dbPath);
  sqliteIndex.init();

  const markdownStore = new MarkdownStore();
  const manifestWriter = new ManifestWriter();
  const milestoneRepo = new MilestoneRepository(sqliteIndex.getRawDb());

  // Build registry — one TaskStore per unique tasksDir
  const registry = new StoreRegistry(config, sqliteIndex, markdownStore, manifestWriter);

  const ctx: ToolContext = {
    store: registry,
    registry,
    index: sqliteIndex,
    sessionId,
    config,
    milestones: milestoneRepo,
  };

  const server = new Server(
    { name: 'agent-tasks', version: pkg.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    return {
      tools: TOOLS.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: 'object' as const,
          ...tool.schema,
        },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const tool = TOOL_MAP.get(toolName);

    if (!tool) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: 'UNKNOWN_TOOL', message: `Unknown tool: ${toolName}` }),
          },
        ],
        isError: true,
      };
    }

    try {
      const input = request.params.arguments ?? {};
      tool.validate(input);
      const result = await tool.execute(input, ctx);
      return result;
    } catch (err) {
      if (err instanceof McpTasksError) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: err.code, message: err.message }),
            },
          ],
          isError: true,
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[agent-tasks] Unexpected error in tool ${toolName}: ${message}\n`);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'An internal error occurred' }),
          },
        ],
        isError: true,
      };
    }
  });

  // Connect transport first so Claude Code's MCP handshake completes immediately
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(`[agent-tasks] Server started. Session: ${sessionId}\n`);

  // Reconcile and start file watchers in the background — must not block connect()
  // watchers declared here so shutdown() can stop them regardless of timing
  const watchers: FileWatcher[] = [];

  const startWatchers = (): void => {
    for (const tasksDir of registry.allTasksDirs()) {
      const watcher = new FileWatcher(
        tasksDir,
        (filePath) => {
          try {
            const task = markdownStore.read(filePath);
            sqliteIndex.upsertTask(task);
          } catch {
            // Skip unparseable files
          }
        },
        (filePath) => {
          const basename = path.basename(filePath, '.md');
          if (basename) sqliteIndex.deleteTask(basename);
        },
        (filePath) => {
          try {
            const task = markdownStore.read(filePath);
            sqliteIndex.upsertTask(task);
          } catch {
            // Skip unparseable files
          }
        },
      );
      watcher.start();
      watchers.push(watcher);
    }
  };

  // Process one project per setImmediate tick to yield the event loop between each,
  // so MCP initialize/tool requests are not blocked by synchronous reconcile work.
  const reconcileNext = (i: number): void => {
    if (i >= config.projects.length) {
      startWatchers();
      return;
    }
    const projectEntry = config.projects[i];
    try {
      const tasksDir = registry.getTasksDirForPrefix(projectEntry.prefix);
      const reconciler = new Reconciler(sqliteIndex, tasksDir, projectEntry.prefix);
      reconciler.reconcile();
    } catch {
      // Skip projects whose tasksDir does not exist yet
    }
    setImmediate(() => reconcileNext(i + 1));
  };
  setImmediate(() => reconcileNext(0));

  // Watch config file for hot-reload
  let configDebounce: ReturnType<typeof setTimeout> | null = null;
  const configWatcher = fs.watch(GLOBAL_CONFIG_PATH, () => {
    if (configDebounce) clearTimeout(configDebounce);
    configDebounce = setTimeout(() => {
      try {
        const newConfig = loadConfig();
        const newRegistry = new StoreRegistry(newConfig, sqliteIndex, markdownStore, manifestWriter);

        for (const entry of newConfig.projects) {
          try {
            const dir = newRegistry.getTasksDirForPrefix(entry.prefix);
            const reconciler = new Reconciler(sqliteIndex, dir, entry.prefix);
            reconciler.reconcile();
          } catch { /* skip missing dirs */ }
        }

        ctx.store = newRegistry;
        ctx.registry = newRegistry;
        ctx.config = newConfig;

        process.stderr.write(`[agent-tasks] Config reloaded — ${newConfig.projects.length} projects registered\n`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[agent-tasks] Config reload failed: ${msg}\n`);
      }
    }, 500);
  });

  // Cleanup on exit
  const shutdown = (): void => {
    configWatcher.close();
    for (const watcher of watchers) {
      watcher.stop();
    }
    sqliteIndex.close();
  };

  process.on('exit', shutdown);
  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[agent-tasks] Fatal startup error: ${message}\n`);
  process.exit(1);
});
