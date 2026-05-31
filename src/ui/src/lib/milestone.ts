import type { Milestone } from '../types'

/**
 * A milestone's owning project is encoded in its ID. The real Milestone type has no `project`
 * field, and milestones live in a per-project store keyed as `PREFIX-ms-<ts>`. Derive the project
 * from the ID prefix (everything before `-ms-`, falling back to the first dash segment) so filtering
 * uses the milestone's own project rather than the fragile related-task derivation.
 */
export function milestoneProject(ms: Milestone): string {
  const msIdx = ms.id.indexOf('-ms-')
  if (msIdx > 0) return ms.id.slice(0, msIdx)
  const dash = ms.id.indexOf('-')
  return dash > 0 ? ms.id.slice(0, dash) : ms.id
}
