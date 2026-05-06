import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, resolveServerDbPath } from './config/loader.js';
import { SqliteIndex } from './store/sqlite-index.js';
import { MarkdownStore } from './store/markdown-store.js';
import { ManifestWriter } from './store/manifest-writer.js';
import { TaskStore } from './store/task-store.js';
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

  // Resolve storage directory and default project
  const storageDir = config.storageDir;
  const defaultProject = config.projects[0]?.prefix ?? 'DEFAULT';
  const tasksDir = config.projects[0]?.path
    ? path.join(config.projects[0].path, config.tasksDirName)
    : storageDir;

  const dbPath = resolveServerDbPath(tasksDir, config, defaultProject !== 'DEFAULT' ? defaultProject : undefined);

  const sqliteIndex = new SqliteIndex(dbPath);
  sqliteIndex.init();

  const markdownStore = new MarkdownStore();
  const manifestWriter = new ManifestWriter();
  const milestoneRepo = new MilestoneRepository(sqliteIndex.getRawDb());

  const store = new TaskStore(markdownStore, sqliteIndex, manifestWriter, tasksDir, defaultProject);

  // File watcher: sync changes to markdown files back into SQLite
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
      // On delete, remove from index if we can find the task ID from the filename
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

  const ctx: ToolContext = {
    store,
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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(`[agent-tasks] Server started. Session: ${sessionId}\n`);

  // Cleanup on exit
  const shutdown = (): void => {
    watcher.stop();
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
