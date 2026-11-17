import { SignalHigh, SignalLow, SignalMedium, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PRIORITY_LABEL, type Priority } from '@/lib/recommendations'
import { badgeBase } from './Badge'

const STYLE: Record<Priority, { icon: LucideIcon; cls: string }> = {
  high: { icon: SignalHigh, cls: 'bg-attention-bg text-attention-text' },
  medium: { icon: SignalMedium, cls: 'bg-neutral-bg text-neutral-text' },
  low: { icon: SignalLow, cls: 'bg-neutral-bg text-neutral-text' },
}

/** Пріоритет: іконка і текст, колір лише підсилює. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  const { icon: Icon, cls } = STYLE[priority]
  return (
    <span className={cn(badgeBase, cls)} data-priority={priority}>
      <Icon aria-hidden className="size-4 shrink-0" />
      Пріоритет: {PRIORITY_LABEL[priority].toLowerCase()}
    </span>
  )
}
