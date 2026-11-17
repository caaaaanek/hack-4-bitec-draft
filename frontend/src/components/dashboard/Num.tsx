import type { ReactNode } from 'react'
import { Tooltip } from '@/components/ui'
import { cn } from '@/lib/cn'

/** Число з поясненням «що це». Пояснення дублюється видимим підписом поруч, підказка лише доповнює. */
export function Num({
  children,
  hint,
  className,
}: {
  children: ReactNode
  hint: ReactNode
  className?: string
}) {
  return (
    <Tooltip content={hint}>
      <span
        className={cn(
          'tabular cursor-help underline decoration-dotted decoration-1 underline-offset-4',
          className,
        )}
      >
        {children}
      </span>
    </Tooltip>
  )
}
