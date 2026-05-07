import path from 'node:path';
import matter from 'gray-matter';
import type { TaskFrontmatter, TaskStatus, TaskType, Priority } from '../types/task.js';
import type { GitInferenceResult } from './git-inference.js';

export type Confidence = 'high' | 'medium' | 'low' | 'unknown';

export interface ReconcileInference {
  frontmatter: TaskFrontmatter;
  confidence: Confidence;
  reason: string;           // short human-readable explanation
  originalFilename: string; // basename of source scratchpad
  bodyPreview: string;      // first 2000 chars of scratchpad body
}

export interface BuildOptions {
  filePath: string;          // absolute path to scratchpad file
  fileContent: string;       // raw file contents
  id: string;                // already-assigned ID like "HERALD-042"
  project: string;           // project prefix, e.g. "HERALD"
  git: GitInferenceResult;
  fallbackMtime: Date;       // fs.statSync(filePath).mtime
  fallbackBirthtime: Date;   // fs.statSync(filePath).birthtime
  now: Date;                 // for deterministic testing
}

export function deriveSlug(filePath: string): string {
  const base = path.basename(filePath, '.md');
  return base
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function humaniseSlug(slug: string): string {
  return slug
    .split('-')
    .filter(w => w.length > 0)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function extractTitle(body: string, slug: string): string {
  // Search first 50 lines for an H1
  const lines = body.split('\n').slice(0, 50);
  for (const line of lines) {
    const match = /^#\s+(.+)$/.exec(line);
    if (match?.[1]) {
      return match[1].trim().slice(0, 200);
    }
  }
  return humaniseSlug(slug).slice(0, 200);
}

function isMetadataLine(stripped: string): boolean {
  // Bold key-value: **Key**: value  or  **Key** value
  if (/^\*\*[A-Za-z][^*]{1,30}\*\*[:\s]/.test(stripped)) return true;
  // Table row
  if (/^\|/.test(stripped)) return true;
  // Separator row (only if length > 3 to avoid matching short dashes)
  if (/^[-|:\s]+$/.test(stripped) && stripped.length > 3) return true;
  // List item that is itself a bold key-value
  if (/^[-*+]\s+\*\*[A-Za-z]/.test(stripped)) return true;
  return false;
}

export function extractWhy(body: string): string {
  // Find first non-empty paragraph after the first H1 (or from start if no H1)
  const lines = body.split('\n');
  let pastH1 = false;
  let hasH1 = false;

  // Check if there's an H1
  for (const line of lines) {
    if (/^#\s/.test(line)) {
      hasH1 = true;
      break;
    }
  }

  const paragraphLines: string[] = [];
  let inParagraph = false;

  for (const line of lines) {
    if (!pastH1) {
      if (hasH1 && /^#\s/.test(line)) {
        pastH1 = true;
      } else if (!hasH1) {
        pastH1 = true;
        // Process this line
      } else {
        continue;
      }
    }

    // Skip headings
    if (/^#+\s/.test(line)) {
      if (inParagraph) break; // found a heading after starting a paragraph
      continue;
    }

    const stripped = line
      .replace(/^>\s*/, '')
      .trim();

    if (stripped.length > 0) {
      // Skip structured metadata lines (bold key-value, table rows, etc.)
      if (isMetadataLine(stripped)) continue;
      // Strip list item markers only for non-metadata lines
      const content = stripped.replace(/^[-*+]\s+/, '').trim();
      if (content.length > 0) {
        inParagraph = true;
        paragraphLines.push(content);
      }
    } else if (inParagraph) {
      // Blank line ends the paragraph
      break;
    }
  }

  // Require at least one line that looks like prose (has a space and length >= 20)
  const hasProse = paragraphLines.some(l => l.includes(' ') && l.length >= 20);
  if (!hasProse) return '';

  return paragraphLines.join(' ').trim().slice(0, 500);
}

export function inferType(slug: string, title: string, filename: string): TaskType {
  // Suffix signals — highest priority
  const slugBase = slug.replace(/-+/g, '-');
  if (/-plan$/.test(slugBase) || /-spec$/.test(slugBase)) return 'feature';

  if (/feat|feature|phase|plan|implement/i.test(slug) || /feat|feature|phase|plan|implement/i.test(title)) {
    return 'feature';
  }
  if (/fix|bugfix|hotfix/i.test(slug) || /fix|bugfix|hotfix/i.test(title)) {
    return 'bug';
  }
  // filename is used as a discriminator (e.g. for future extensions)
  void filename;
  return 'chore';
}

export function inferPriority(slug: string): Priority {
  if (/fix|critical|hotfix|urgent/i.test(slug)) {
    return 'high';
  }
  return 'medium';
}

export function inferStatus(
  git: GitInferenceResult,
  fallbackMtime: Date,
  now: Date,
): { status: TaskStatus; confidence: Confidence; reason: string } {
  // 1. Merged with branch identified → high confidence
  if (git.merged && git.mergeCommitSha !== undefined && git.branch !== undefined) {
    return {
      status: 'done',
      confidence: 'high',
      reason: `branch merged via ${git.mergeCommitSha}`,
    };
  }

  // 1b. Merged but only slug matched (no branch found) → medium confidence
  if (git.merged && git.mergeCommitSha !== undefined) {
    return {
      status: 'done',
      confidence: 'medium',
      reason: `slug found in merge commit ${git.mergeCommitSha}`,
    };
  }

  // 2. Branch exists, not merged
  if (git.branch !== undefined && !git.merged) {
    return {
      status: 'in_progress',
      confidence: 'medium',
      reason: `branch ${git.branch} exists, no merge`,
    };
  }

  // 3. mtime within 30 days
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  if (now.getTime() - fallbackMtime.getTime() < thirtyDaysMs) {
    return {
      status: 'in_progress',
      confidence: 'low',
      reason: 'modified in last 30 days',
    };
  }

  // 4. Git was usable but no signal
  const gitUsable = git.firstCommitDate !== undefined || git.lastCommitDate !== undefined;
  if (gitUsable) {
    return {
      status: 'todo',
      confidence: 'low',
      reason: 'no git or fs signal',
    };
  }

  // 5. Git entirely unavailable
  return {
    status: 'todo',
    confidence: 'unknown',
    reason: 'no signal available',
  };
}

export function buildInference(opts: BuildOptions): ReconcileInference {
  const {
    filePath,
    fileContent,
    id,
    project,
    git,
    fallbackMtime,
    fallbackBirthtime,
    now,
  } = opts;

  const slug = deriveSlug(filePath);

  // Parse with gray-matter — use parsed.content (body without frontmatter)
  const parsed = matter(fileContent);
  const body = parsed.content;

  const title = extractTitle(body, slug);
  const type = inferType(slug, title, path.basename(filePath));
  const priority = inferPriority(slug);
  const why = extractWhy(body);
  const { status, confidence, reason } = inferStatus(git, fallbackMtime, now);

  const created = git.firstCommitDate ?? fallbackBirthtime.toISOString();
  const updated = git.lastCommitDate ?? fallbackMtime.toISOString();
  const last_activity = updated;

  const tags: string[] = (confidence === 'unknown' || confidence === 'low') ? ['needs_review'] : [];

  // Build git link
  const gitLink = {
    branch: git.branch,
    commits: [] as import('../types/task.js').CommitRef[],
    ...(git.prNumber !== undefined
      ? {
          pr: {
            number: git.prNumber,
            url: '',
            title: '',
            state: 'merged' as const,
            merged_at: null,
            base_branch: git.baseBranch,
          },
        }
      : {}),
  };

  const frontmatter: TaskFrontmatter = {
    schema_version: 1,
    id,
    title,
    type,
    status,
    priority,
    project,
    tags,
    complexity: 5,
    complexity_manual: false,
    why,
    created,
    updated,
    last_activity,
    claimed_by: null,
    claimed_at: null,
    claim_ttl_hours: 4,
    parent: null,
    children: [],
    dependencies: [],
    subtasks: [],
    git: gitLink,
    transitions: [],
    files: [],
  };

  const bodyPreview = body.slice(0, 2000);

  return {
    frontmatter,
    confidence,
    reason,
    originalFilename: path.basename(filePath),
    bodyPreview,
  };
}
