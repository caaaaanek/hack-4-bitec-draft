import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type IconTone = 'culture' | 'system' | 'accountability' | 'accent' | 'neutral'

const TONES: Record<IconTone, string> = {
  culture: 'bg-cat-culture-soft text-cat-culture',
  system: 'bg-cat-system-soft text-cat-system',
  accountability: 'bg-cat-accountability-soft text-cat-accountability',
  accent: 'bg-accent-soft text-accent',
  neutral: 'bg-surface-muted text-text-muted',
}

/** Піктограма в тонованому колі: колір категорії лише підсилює, назву дає підпис поруч. */
export function IconCircle({
  tone = 'accent',
  size = 32,
  className,
  children,
}: {
  tone?: IconTone
  size?: number
  className?: string
  children: ReactNode
}) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
