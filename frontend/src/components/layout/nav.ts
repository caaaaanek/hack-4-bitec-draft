import {
  ClipboardCheck,
  ClipboardList,
  FileText,
  Building2,
  Columns2,
  Database,
  Gauge,
  History,
  Lightbulb,
  ListChecks,
  ListTree,
  TrendingUp,
  PencilLine,
  Settings,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { canAccess, type Role } from '@/lib/access'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/institutions', label: 'Заклади', icon: Building2 },
  { to: '/', label: 'Огляд', icon: Gauge, end: true },
  { to: '/explain', label: 'Розклад індексу', icon: ListTree },
  { to: '/compare', label: 'Порівняння', icon: Columns2 },
  { to: '/trends', label: 'Динаміка', icon: TrendingUp },
  { to: '/recommendations', label: 'Рекомендації', icon: Lightbulb },
  { to: '/tracker', label: 'Трекер', icon: ListChecks },
  { to: '/integrations', label: 'Звідки беруться дані', icon: Database },
  { to: '/reports', label: 'Звіт', icon: FileText },
  { to: '/manage', label: 'Керування циклом', icon: Settings },
  { to: '/surveys', label: 'Анкети', icon: ClipboardList },
  { to: '/checklist', label: 'Чек-лист', icon: ClipboardCheck },
  { to: '/audit', label: 'Журнал', icon: History },
  { to: '/s/demo', label: 'Пройти опитування', icon: PencilLine },
  { to: '/me', label: 'Мої результати', icon: UserRound },
]

/** Лише розділи, доступні ролі. */
export const navFor = (role: Role): NavItem[] => NAV_ITEMS.filter((i) => canAccess(role, i.to))
