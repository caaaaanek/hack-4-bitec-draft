import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export type BadgeTone = 'neutral' | 'accent' | 'strength' | 'attention' | 'critical'

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-bg text-neutral-text',
  accent: 'bg-accent-soft text-accent',
  strength: 'bg-strength-bg text-strength-text',
  attention: 'bg-attention-bg text-attention-text',
  critical: 'bg-critical-bg text-critical-text',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

export const badgeBase =
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-fine font-semibold whitespace-nowrap tabular'

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  return <span className={cn(badgeBase, tones[tone], className)} {...rest} />
}
