import {
  LayoutDashboard, Trello, MessageSquare, Brain,
  Package, Map, Activity, type LucideIcon
} from 'lucide-react'
import type { ViewId } from '../types'

export interface NavItem {
  id: ViewId
  label: string
  icon: LucideIcon
  kbd: number   // 1-based number shortcut (1–7)
}

export const NAV: NavItem[] = [
  { id: 'today',     label: 'Today',      icon: LayoutDashboard, kbd: 1 },
  { id: 'board',     label: 'Board',      icon: Trello,          kbd: 2 },
  { id: 'hermes',    label: 'Hermes',     icon: MessageSquare,   kbd: 3 },
  { id: 'braindump', label: 'Brain dump', icon: Brain,           kbd: 4 },
  { id: 'artifacts', label: 'Artifacts',  icon: Package,         kbd: 5 },
  { id: 'roadmap',   label: 'Roadmap',    icon: Map,             kbd: 6 },
  { id: 'activity',  label: 'Activity',   icon: Activity,        kbd: 7 },
]
