/**
 * Pure assembly of the project list returned by `GET /api/projects`.
 *
 * The list drives the action button and the dashboard's project filter. Registered projects come
 * from config; the auto-initialised global **GEN** project lives outside config (under the home dir)
 * so it must be appended explicitly — otherwise it never appears in the filter (P5-09 AC3).
 *
 * Extracted as a pure function so the GEN-append behaviour is unit-testable without booting the
 * server or staging a GEN store under the real home directory.
 */
export interface ProjectListEntry {
  prefix: string;
  name?: string;
  path: string;
}

export function buildProjectsList(
  configProjects: ReadonlyArray<{ prefix: string; name?: string; path: string }>,
  genTasksDir: string | null,
): ProjectListEntry[] {
  // Always emit `name`, falling back to the prefix — a uniform API contract so consumers never have to
  // implement their own fallback (AC1). `name === prefix` signals "no friendly name set".
  const projects: ProjectListEntry[] = configProjects.map(p => ({
    prefix: p.prefix,
    name: p.name ?? p.prefix,
    path: p.path,
  }));
  if (genTasksDir && !projects.some(p => p.prefix === 'GEN')) {
    projects.push({ prefix: 'GEN', name: 'GEN', path: genTasksDir });
  }
  return projects;
}
