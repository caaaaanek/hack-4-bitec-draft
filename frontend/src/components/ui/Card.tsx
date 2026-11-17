import type { ElementType, HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType
  interactive?: boolean
  className?: string
  children?: ReactNode
}

export function Card({ as, interactive = false, className, children, ...rest }: CardProps) {
  const Tag: ElementType = as ?? 'div'
  return (
    <Tag
      data-print="card"
      className={cn(
        'card relative min-w-0 rounded-lg border border-border bg-surface',
        // Власні відступи в className мають перевагу над типовими.
        !/(^|\s)(md:|short:)*p-/.test(className ?? '') && 'p-4 md:p-5',
        interactive &&
          'transition-shadow duration-150 ease-standard hover:bg-surface-raised hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  )
}

export function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mb-3 flex items-start justify-between gap-3', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardTitle({
  as: Tag = 'h3',
  icon,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & { as?: ElementType; icon?: ReactNode }) {
  return (
    <Tag className={cn('card-title', className)} {...rest}>
      {icon}
      {children}
    </Tag>
  )
}
