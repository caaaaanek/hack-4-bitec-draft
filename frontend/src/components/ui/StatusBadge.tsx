import { cn } from '@/lib/cn'
import { STATUSES, type StatusId } from './config'
import { badgeBase } from './Badge'

export function StatusBadge({ status, className }: { status: StatusId; className?: string }) {
  const { label, icon: Icon, classes } = STATUSES[status]
  return (
    <span className={cn(badgeBase, classes, className)} data-status={status}>
      <Icon aria-hidden className="size-4 shrink-0" />
      {label}
    </span>
  )
}
