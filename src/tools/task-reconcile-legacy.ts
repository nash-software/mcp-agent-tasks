import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'yaml';
import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';
import { TaskFactory } from '../store/task-factory.js';
import { inferGitContext } from '../lib/git-inference.js';
import { buildInference } from '../lib/frontmatter-builder.js';
import { DEFAULT_TASKS_DIR_NAME } from '../config/loader.js';
import type { Confidence } from '../lib/frontmatter-builder.js';
import type { TaskStatus } from '../types/task.js';

export const name = 'task_reconcile_legacy';

export const description =
  'Scan a project\'s scratchpads/ directory for legacy plan files (those without schema_version frontmatter) and create properly-formatted task files in tasks/.';

export const schema = {
  type: 'object',
  properties: {
    projectPath: {
      type: 'string',
      description: 'Absolute path to target project root',
    },
    idPrefix: {
      type: 'string',
      description: 'Override project prefix (default: derive from package.json or dir name)',
    },
    dryRun: {
      type: 'boolean',
      description: 'Preview only; do not write any files',
    },
  },
  required: ['projectPath'],
} as const;

interface ValidatedInput {
  projectPath: string;
  idPrefix?: string;
  dryRun?: boolean;
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }

  const raw = input as Record<string, unknown>;

  if (typeof raw['projectPath'] !== 'string' || !raw['projectPath']) {
    throw new McpTasksError('INVALID_FIELD', 'projectPath is required and must be a non-empty string');
  }

  if (raw['idPrefix'] !== undefined) {
    if (typeof raw['idPrefix'] !== 'string') {
      throw new McpTasksError('INVALID_FIELD', 'idPrefix must be a string');
    }
    if (!/^[A-Z][A-Z0-9_]*$/.test(raw['idPrefix'])) {
      throw new McpTasksError(
        'INVALID_FIELD',
        'idPrefix must match /^[A-Z][A-Z0-9_]*$/ (e.g. HERALD, MY_PROJECT)',
      );
    }
  }

  if (raw['dryRun'] !== undefined && typeof raw['dryRun'] !== 'boolean') {
    throw new McpTasksError('INVALID_FIELD', 'dryRun must be a boolean');
  }
}

export interface ReconcileSummary {
  dryRun: boolean;
  scanned: number;
  written: number;
  skipped: number;
  results: Array<{
    file: string;           // relative scratchpad filename
    id: string;
    status: TaskStatus;
    confidence: Confidence;
    reason: string;
    outputPath: string | null; // null when dryRun
    error?: string;
  }>;
}

function derivePrefix(projectPath: string): string {
  // Try package.json name field
  try {
    const pkgPath = path.join(projectPath, 'package.json');
    const pkgRaw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { name?: unknown };
    if (typeof pkg.name === 'string' && pkg.name.length > 0) {
      // Strip @scope/ prefix, sanitise to uppercase [A-Z0-9_]
      const stripped = pkg.name.replace(/^@[^/]+\//, '');
      const sanitised = stripped.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (sanitised.length > 0) return sanitised;
    }
  } catch {
    // fall through
  }

  // Fall back to directory name
  return path.basename(projectPath).toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'PROJECT';
}

function isArtifactFile(filename: string): boolean {
  // ALL_CAPS filenames (e.g. TEST_RESULTS.md, SONNET_ROUTING_DECISION.md, PHASE_6_COMPLETION.md)
  // but not HANDOFF.md (already handled by slug-length guards)
  const base = filename.replace(/\.md$/i, '');
  if (/^[A-Z][A-Z0-9_-]+$/.test(base) && base !== 'HANDOFF') return true;
  // Session state files (run-phases output)
  if (/^run-phases-/i.test(filename)) return true;
  // Completion markers
  if (/-COMPLETE\.md$/i.test(filename)) return true;
  // Flag files
  if (/\.flag$/i.test(filename)) return true;
  return false;
}

function findMaxExistingNum(tasksDir: string, prefix: string): number {
  try {
    if (!fs.existsSync(tasksDir)) return 0;
    const files = fs.readdirSync(tasksDir);
    const re = new RegExp(`^${prefix}-(\\d+)`);
    let max = 0;
    for (const f of files) {
      const m = re.exec(f);
      if (m?.[1]) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }
    return max;
  } catch {
    return 0;
  }
}

export async function reconcileLegacy(opts: {
  projectPath: string;
  idPrefix?: string;
  dryRun?: boolean;
  tasksDirName?: string;
}): Promise<ReconcileSummary> {
  const projectPath = path.resolve(opts.projectPath);
  const dryRun = opts.dryRun ?? false;

  const prefix = opts.idPrefix ?? derivePrefix(projectPath);

  const scratchpadsDir = path.join(projectPath, 'scratchpads');
  if (!fs.existsSync(scratchpadsDir)) {
    return { dryRun, scanned: 0, written: 0, skipped: 0, results: [] };
  }

  const tasksDir = path.join(projectPath, opts.tasksDirName ?? DEFAULT_TASKS_DIR_NAME);
  if (!dryRun && !fs.existsSync(tasksDir)) {
    fs.mkdirSync(tasksDir, { recursive: true });
  }

  // List top-level *.md files
  const allFiles = fs.readdirSync(scratchpadsDir);
  const legacyFiles: string[] = [];

  for (const filename of allFiles) {
    if (!filename.endsWith('.md')) continue;
    // Skip known artifact/report files — these are never tasks
    if (isArtifactFile(filename)) continue;
    const filePath = path.join(scratchpadsDir, filename);
    // Only include regular files (non-recursive)
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }

    // Filter out files that already have schema_version in frontmatter
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = matter(content);
      if (parsed.data && typeof parsed.data === 'object' && 'schema_version' in parsed.data) {
        continue; // Not legacy
      }
    } catch {
      // If we can't parse, treat as legacy
    }

    legacyFiles.push(filename);
  }

  // Determine next sequential ID
  let nextNum = findMaxExistingNum(tasksDir, prefix) + 1;
  const factory = new TaskFactory();

  const results: ReconcileSummary['results'] = [];
  let written = 0;
  let skipped = 0;

  for (const filename of legacyFiles) {
    const filePath = path.join(scratchpadsDir, filename);

    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const stat = fs.statSync(filePath);

      // Derive slug for git inference (same logic as deriveSlug)
      const slug = path.basename(filePath, '.md')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const git = inferGitContext({ projectPath, slug, filePath });

      const id = factory.formatId(prefix, nextNum++);

      const inference = buildInference({
        filePath,
        fileContent,
        id,
        project: prefix,
        git,
        fallbackMtime: stat.mtime,
        fallbackBirthtime: stat.birthtime,
        now: new Date(),
      });

      const outputPath = path.join(tasksDir, `${id}-${slug}.md`);

      // Check if ANY file for this slug already exists in tasks dir (idempotency guard)
      const slugAlreadyExists =
        fs.existsSync(tasksDir) &&
        fs.readdirSync(tasksDir).some(f => {
          const withoutPrefix = f.replace(/^[A-Z][A-Z0-9_]*-\d+-/, '');
          return withoutPrefix === `${slug}.md` || f === `${id}-${slug}.md`;
        });

      if (dryRun) {
        results.push({
          file: filename,
          id,
          status: inference.frontmatter.status,
          confidence: inference.confidence,
          reason: inference.reason,
          outputPath: null,
        });
        continue;
      }

      // Check if output file already exists (exact or slug-based match)
      if (slugAlreadyExists) {
        results.push({
          file: filename,
          id,
          status: inference.frontmatter.status,
          confidence: inference.confidence,
          reason: inference.reason,
          outputPath,
          error: 'output file already exists',
        });
        skipped++;
        continue;
      }

      // Serialise frontmatter using yaml package
      const yamlStr = yaml.stringify(inference.frontmatter);
      const fileOutput = `---\n${yamlStr}---\n\n${inference.bodyPreview}\n`;
      fs.writeFileSync(outputPath, fileOutput, 'utf-8');

      results.push({
        file: filename,
        id,
        status: inference.frontmatter.status,
        confidence: inference.confidence,
        reason: inference.reason,
        outputPath,
      });
      written++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const id = factory.formatId(prefix, nextNum - 1); // use last assigned num
      results.push({
        file: filename,
        id,
        status: 'todo',
        confidence: 'unknown',
        reason: 'error during processing',
        outputPath: null,
        error: errorMsg,
      });
      skipped++;
    }
  }

  return {
    dryRun,
    scanned: legacyFiles.length,
    written,
    skipped,
    results,
  };
}

export async function execute(input: ValidatedInput, _ctx: ToolContext): Promise<ToolOutput> {
  const summary = await reconcileLegacy({
    projectPath: input.projectPath,
    idPrefix: input.idPrefix,
    dryRun: input.dryRun,
  });

  return ok({
    dryRun: summary.dryRun,
    results: summary.results,
    written: summary.written,
    skipped: summary.skipped,
  });
}
