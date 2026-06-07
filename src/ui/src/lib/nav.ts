import {
  LayoutDashboard, Trello, MessageSquare, Brain,
  Package, Map, Activity, CheckCircle, StickyNote, Lightbulb, ListChecks, type LucideIcon
} from 'lucide-react'
import type { ViewId } from '../types'

export interface NavItem {
  id: ViewId
  label: string
  icon: LucideIcon
  /** Keyboard shortcut digit: 1–9 for indices 0–8, 0 for index 9 (Completed). -1 = no shortcut. */
  kbd: number
}

/** Canonical flat nav list — source of truth for shortcuts and counts. */
export const NAV: NavItem[] = [
  { id: 'today',     label: 'Today',      icon: LayoutDashboard, kbd: 1 },
  { id: 'board',     label: 'Board',      icon: Trello,          kbd: 2 },
  { id: 'braindump', label: 'Brain dump', icon: Brain,           kbd: 3 },
  { id: 'notes',     label: 'Notes',      icon: StickyNote,      kbd: 4 },
  { id: 'advisor',   label: 'Advisor',    icon: Lightbulb,       kbd: 5 },
  { id: 'hermes',    label: 'Hermes',     icon: MessageSquare,   kbd: 6 },
  { id: 'triage',    label: 'Triage',     icon: ListChecks,      kbd: -1 },
  { id: 'artifacts', label: 'Artifacts',  icon: Package,         kbd: 7 },
  { id: 'roadmap',   label: 'Roadmap',    icon: Map,             kbd: 8 },
  { id: 'activity',  label: 'Activity',   icon: Activity,        kbd: 9 },
  { id: 'completed', label: 'Completed',  icon: CheckCircle,     kbd: 0 },
]

/** Lookup by ViewId — derived from NAV, for O(1) access in render. */
export const NAV_BY_ID: Record<ViewId, NavItem> = Object.fromEntries(
  NAV.map(item => [item.id, item])
) as Record<ViewId, NavItem>

export interface NavGroup {
  label: string
  ids: ViewId[]
}

/** Grouped rendering order — drives sidebar section labels.
 *  Flat NAV remains the source of truth for shortcuts/counts.
 */
export const NAV_GROUPS: NavGroup[] = [
  { label: 'Workspace',  ids: ['today', 'board', 'braindump', 'notes'] },
  { label: 'Assistants', ids: ['advisor', 'hermes', 'triage'] },
  { label: 'Library',    ids: ['artifacts', 'roadmap', 'activity', 'completed'] },
]
