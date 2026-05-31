/**
 * Source-inspection tests for MCPAT-063 UI phases (6, 7, 8).
 * Uses readFileSync — consistent with ui-task-panel.test.ts (node env, no jsdom).
 *
 * Covers:
 *   Phase 6 — api.ts exports createProject / updateProject / listDir
 *   Phase 7 — ProjectsModal structure (list, edit-name, add form, folder browser, error surface)
 *             Nav settings cog (onOpenProjects prop, aria-label="Manage projects")
 *             App.tsx wiring (projectsModalOpen, ProjectsModal import)
 *   Phase 8 — "PREFIX — Name" rendering in Nav favourites + FilterBar
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const uiSrc = path.join(root, 'src', 'ui', 'src');

function readUiFile(relPath: string): string {
  return fs.readFileSync(path.join(uiSrc, relPath), 'utf-8');
}

// ── Phase 6 — api.ts ─────────────────────────────────────────────────────────
describe('api.ts — Phase 6 client API', () => {
  const src = readUiFile('api.ts');

  it('exports createProject function', () => {
    expect(src).toContain('export async function createProject');
  });

  it('createProject sends POST to /api/projects', () => {
    expect(src).toContain("'/api/projects'");
    expect(src).toContain("method: 'POST'");
  });

  it('exports updateProject function', () => {
    expect(src).toContain('export async function updateProject');
  });

  it('updateProject sends PATCH to /api/projects/:prefix', () => {
    expect(src).toContain('`/api/projects/${prefix}`');
    expect(src).toContain("method: 'PATCH'");
  });

  it('exports listDir function', () => {
    expect(src).toContain('export async function listDir');
  });

  it('listDir calls /api/fs/list', () => {
    expect(src).toContain('/api/fs/list');
  });

  it('listDir appends ?path= when path provided', () => {
    expect(src).toContain('encodeURIComponent(path)');
  });

  it('all three new functions throw on !res.ok', () => {
    // Each should have error handling
    const createSection = src.slice(src.indexOf('export async function createProject'));
    const updateSection = src.slice(src.indexOf('export async function updateProject'));
    const listSection   = src.slice(src.indexOf('export async function listDir'));
    expect(createSection).toContain('!res.ok');
    expect(updateSection).toContain('!res.ok');
    expect(listSection).toContain('!res.ok');
  });
});

// ── Phase 7 — ProjectsModal ───────────────────────────────────────────────────
describe('ProjectsModal.tsx — structure', () => {
  const src = readUiFile('components/ProjectsModal.tsx');

  it('returns null when !open', () => {
    expect(src).toContain('if (!open) return null');
  });

  it('uses fixed inset-0 z-50 backdrop', () => {
    expect(src).toContain('fixed inset-0 z-50');
  });

  it('uses w-[440px] max-w-[92vw] panel width', () => {
    expect(src).toContain('w-[440px]');
    expect(src).toContain('max-w-[92vw]');
  });

  it('uses bg-surface-1 panel background', () => {
    expect(src).toContain('bg-surface-1');
  });

  it('has header with close button (×)', () => {
    expect(src).toContain('Manage projects');
    expect(src).toContain('×');
  });

  it('has error alert with role="alert"', () => {
    expect(src).toContain('role="alert"');
    expect(src).toContain('errorMsg');
    expect(src).toContain('status-red');
  });

  it('lists existing projects section', () => {
    expect(src).toContain('Existing projects');
    expect(src).toContain('projects.map');
  });

  it('has inline name editing via updateProject', () => {
    expect(src).toContain('updateProject');
    expect(src).toContain('InlineNameEditor');
  });

  it('has Add project form section', () => {
    expect(src).toContain('Add project');
  });

  it('has prefix input in add form', () => {
    expect(src).toContain('Project prefix');
    expect(src).toContain('setPrefix');
  });

  it('has name input in add form', () => {
    expect(src).toContain('Project name');
    expect(src).toContain('setName');
  });

  it('has storage select (global/local)', () => {
    expect(src).toContain('Storage');
    expect(src).toContain("value=\"global\"");
    expect(src).toContain("value=\"local\"");
  });

  it('has FolderBrowser sub-component', () => {
    expect(src).toContain('FolderBrowser');
    expect(src).toContain('listDir');
  });

  it('FolderBrowser uses useQuery with [\'fs-list\', ...] queryKey', () => {
    expect(src).toContain("'fs-list'");
    expect(src).toContain('queryKey:');
  });

  it('surfaces errors from createProject (duplicate prefix / bad path)', () => {
    expect(src).toContain('setErrorMsg');
    expect(src).toContain('createProject');
  });

  it('invalidates [\'projects\'] on success', () => {
    expect(src).toContain("queryKey: ['projects']");
    expect(src).toContain('invalidateQueries');
  });

  it('uses useMutation for createProject', () => {
    expect(src).toContain('useMutation');
    expect(src).toContain('addMutation');
  });

  it('accepts open / onClose / projects props', () => {
    expect(src).toContain('open: boolean');
    expect(src).toContain('onClose: () => void');
    expect(src).toContain('projects: ProjectEntry[]');
  });

  it('footer has Add project and Close buttons', () => {
    expect(src).toContain('Add project');
    expect(src).toContain('Close');
  });

  it('closes on Escape key', () => {
    expect(src).toContain("e.key === 'Escape'");
    expect(src).toContain('onClose()');
  });
});

// ── Phase 7 — Nav.tsx settings cog ───────────────────────────────────────────
describe('Nav.tsx — settings cog', () => {
  const src = readUiFile('components/Nav.tsx');

  it('accepts onOpenProjects prop', () => {
    expect(src).toContain('onOpenProjects');
  });

  it('has settings cog button with aria-label="Manage projects"', () => {
    expect(src).toContain('aria-label="Manage projects"');
  });

  it('settings cog button calls onOpenProjects on click', () => {
    expect(src).toContain('onClick={onOpenProjects}');
  });

  it('settings cog button has a gear SVG icon', () => {
    // SVG circle (the inner circle of a gear)
    expect(src).toContain('<circle cx="12" cy="12" r="3"');
  });

  it('settings cog button shows "Projects" label text', () => {
    expect(src).toContain('Projects');
  });
});

// ── Phase 7 — App.tsx wiring ─────────────────────────────────────────────────
describe('App.tsx — ProjectsModal wiring', () => {
  const src = readUiFile('App.tsx');

  it('imports ProjectsModal', () => {
    expect(src).toContain("import { ProjectsModal }");
  });

  it('has projectsModalOpen state', () => {
    expect(src).toContain('projectsModalOpen');
    expect(src).toContain('setProjectsModalOpen');
  });

  it('renders ProjectsModal with open/onClose/projects props', () => {
    expect(src).toContain('<ProjectsModal');
    expect(src).toContain('open={projectsModalOpen}');
    expect(src).toContain('onClose={() => setProjectsModalOpen(false)}');
    expect(src).toContain('projects={projectEntries}');
  });

  it('passes onOpenProjects to Nav', () => {
    expect(src).toContain('onOpenProjects=');
    expect(src).toContain('setProjectsModalOpen(true)');
  });
});

// ── Phase 8 — Nav.tsx "PREFIX — Name" badges ─────────────────────────────────
describe('Nav.tsx — "PREFIX — Name" favourites rendering', () => {
  const src = readUiFile('components/Nav.tsx');

  it('shows "PREFIX — Name" when proj.name exists and differs from prefix', () => {
    expect(src).toContain('proj.name && proj.name !== prefix');
    expect(src).toContain('`${prefix} — ${proj.name}`');
  });

  it('falls back to bare prefix when no name', () => {
    // The ternary expression falls back to `prefix` when name is absent
    expect(src).toMatch(/proj\.name.*prefix.*prefix/s);
  });
});

// ── Phase 8 — FilterBar.tsx "PREFIX — Name" badges ───────────────────────────
describe('FilterBar.tsx — "PREFIX — Name" project chips', () => {
  const src = readUiFile('components/FilterBar.tsx');

  it('fav-chip shows "PREFIX — Name" when name differs from prefix', () => {
    expect(src).toContain('p.name && p.name !== p.prefix');
    expect(src).toContain('`${p.prefix} — ${p.name}`');
  });

  it('popover project row shows "PREFIX — Name" in fpr-name span', () => {
    expect(src).toContain('fpr-name');
    // The name span shows "PREFIX — Name" when name differs (p.prefix — p.name pattern)
    expect(src).toContain('"fpr-name"');
    expect(src).toContain('p.name !== p.prefix');
  });

  it('FilterBar still renders p.prefix in the chip fpr-prefix span', () => {
    // Compact prefix is preserved on the quick-chips
    expect(src).toContain('fc-prefix');
  });
});

// ── Phase 8 — App.tsx filterProjects uses real project names ─────────────────
describe('App.tsx — filterProjects uses name from projectEntries', () => {
  const src = readUiFile('App.tsx');

  it('builds a nameByPrefix map from projectEntries', () => {
    expect(src).toContain('nameByPrefix');
    expect(src).toContain('projectEntries.map');
  });

  it('filterProjects uses nameByPrefix.get(prefix) for the name field', () => {
    expect(src).toContain('nameByPrefix.get(prefix)');
  });
});
