import { execFileSync } from 'node:child_process';

export interface MergedPr {
  number: number;
  title: string;
  headRefName: string;
  mergedAt: string;
  body: string;
  url: string;
}

// gh is a native Windows exe — cmd.exe resolves it fine.
// On non-Windows, no shell wrapping needed.
const SHELL: boolean | undefined = process.platform === 'win32' ? true : undefined;

function isGhAvailable(): boolean {
  try {
    execFileSync('gh', ['--version'], { stdio: 'pipe', encoding: 'utf-8', shell: SHELL });
    return true;
  } catch {
    return false;
  }
}

export function listMergedPrs(projectPath: string, limit = 300): MergedPr[] {
  if (!isGhAvailable()) return [];
  try {
    const out = execFileSync(
      'gh', ['pr', 'list', '--state', 'merged', '--json', 'number,title,headRefName,mergedAt,body,url', '--limit', String(limit)],
      { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe', timeout: 30_000, shell: SHELL },
    );
    const raw = JSON.parse(out) as Array<{ number: number; title: string; headRefName: string; mergedAt: string; body?: string; url?: string }>;
    return raw.map(p => ({
      number: p.number,
      title: p.title,
      headRefName: p.headRefName,
      mergedAt: p.mergedAt,
      body: p.body ?? '',
      url: p.url ?? '',
    }));
  } catch {
    return [];
  }
}

export function findPrByBranch(projectPath: string, branch: string): MergedPr | undefined {
  if (!isGhAvailable()) return undefined;
  // Strip remote prefix if present
  const cleanBranch = branch.replace(/^origin\//, '');
  try {
    const out = execFileSync(
      'gh', ['pr', 'list', '--state', 'merged', '--head', cleanBranch, '--json', 'number,title,headRefName,mergedAt,body,url', '--limit', '1'],
      { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe', timeout: 15_000, shell: SHELL },
    );
    const raw = JSON.parse(out) as Array<Partial<MergedPr> & { number: number }>;
    const first = raw[0];
    if (!first) return undefined;
    return {
      number: first.number,
      title: first.title ?? '',
      headRefName: first.headRefName ?? '',
      mergedAt: first.mergedAt ?? '',
      body: first.body ?? '',
      url: first.url ?? '',
    };
  } catch {
    return undefined;
  }
}
