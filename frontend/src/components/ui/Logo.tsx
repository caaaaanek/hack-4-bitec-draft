import { Activity } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Знак продукту: лаймовий квадрат із заокругленням і піктограмою динаміки. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-primary text-on-primary',
        className,
      )}
    >
      <Activity className="size-[18px]" strokeWidth={2.2} />
    </span>
  )
}
