import {
  AlarmClock,
  CheckCheck,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleOff,
  MessageSquareText,
  ShieldCheck,
  ShieldQuestion,
  type LucideIcon,
} from 'lucide-react'

export type StatusId =
  | 'proposed'
  | 'accepted'
  | 'clarified'
  | 'rejected'
  | 'inprogress'
  | 'done'
  | 'confirmed'
  | 'notconfirmed'
  | 'overdue'

export const STATUSES: Record<StatusId, { label: string; icon: LucideIcon; classes: string }> = {
  proposed: {
    label: 'Запропоновано',
    icon: CircleDashed,
    classes: 'bg-status-proposed-bg text-status-proposed-text',
  },
  accepted: {
    label: 'Прийнято',
    icon: CircleCheck,
    classes: 'bg-status-accepted-bg text-status-accepted-text',
  },
  clarified: {
    label: 'Уточнено',
    icon: MessageSquareText,
    classes: 'bg-status-clarified-bg text-status-clarified-text',
  },
  rejected: {
    label: 'Відхилено',
    icon: CircleOff,
    classes: 'bg-status-rejected-bg text-status-rejected-text',
  },
  inprogress: {
    label: 'В роботі',
    icon: CircleDot,
    classes: 'bg-status-inprogress-bg text-status-inprogress-text',
  },
  done: { label: 'Виконано', icon: CheckCheck, classes: 'bg-status-done-bg text-status-done-text' },
  confirmed: {
    label: 'Підтверджено',
    icon: ShieldCheck,
    classes: 'bg-status-confirmed-bg text-status-confirmed-text',
  },
  notconfirmed: {
    label: 'Не підтверджено',
    icon: ShieldQuestion,
    classes: 'bg-status-notconfirmed-bg text-status-notconfirmed-text',
  },
  overdue: {
    label: 'Прострочено',
    icon: AlarmClock,
    classes: 'bg-status-overdue-bg text-status-overdue-text',
  },
}

export type MaturityLevel = 1 | 2 | 3 | 4 | 5

export const MATURITY: Record<MaturityLevel, { name: string; classes: string }> = {
  1: {
    name: 'Початковий (хаотичний)',
    classes: 'bg-maturity-1-bg text-maturity-1-text border-maturity-1-chart',
  },
  2: {
    name: 'Керований',
    classes: 'bg-maturity-2-bg text-maturity-2-text border-maturity-2-chart',
  },
  3: {
    name: 'Визначений',
    classes: 'bg-maturity-3-bg text-maturity-3-text border-maturity-3-chart',
  },
  4: {
    name: 'Вимірюваний',
    classes: 'bg-maturity-4-bg text-maturity-4-text border-maturity-4-chart',
  },
  5: {
    name: 'Оптимізуючий',
    classes: 'bg-maturity-5-bg text-maturity-5-text border-maturity-5-chart',
  },
}

export type SourceId = 'wg' | 'os' | 'experts' | 'facts'

export const SOURCES: Record<
  SourceId,
  { label: string; color: string; shape: 'circle' | 'square' | 'diamond' | 'triangle' }
> = {
  wg: { label: 'Сприйняття РГ', color: 'var(--color-source-wg)', shape: 'circle' },
  os: { label: 'Сприйняття ОС', color: 'var(--color-source-os)', shape: 'square' },
  experts: { label: 'Експерти', color: 'var(--color-source-experts)', shape: 'diamond' },
  facts: { label: 'Факти', color: 'var(--color-source-facts)', shape: 'triangle' },
}
