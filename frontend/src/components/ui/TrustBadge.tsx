import { ShieldAlert, ShieldCheck, Shield, ShieldQuestion } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { TrustGrade } from '@/lib/scoring/trust'
import { badgeBase } from './Badge'
import { TRUST_GRADE_TEXT, TRUST_LABEL } from './messages'

const STYLE = {
  A: { icon: ShieldCheck, classes: 'bg-strength-bg text-strength-text' },
  B: { icon: Shield, classes: 'bg-attention-bg text-attention-text' },
  C: {
    icon: ShieldAlert,
    classes: 'bg-attention-bg text-attention-text ring-2 ring-attention-solid',
  },
  insufficient: { icon: ShieldQuestion, classes: 'bg-neutral-bg text-neutral-text' },
} as const

/** Достовірність: літера, іконка й слово. Колір лише підсилює. */
export function TrustBadge({ grade, className }: { grade: TrustGrade; className?: string }) {
  const { icon: Icon, classes } = STYLE[grade]
  const { letter, word } = TRUST_GRADE_TEXT[grade]
  return (
    <span className={cn(badgeBase, classes, className)} data-trust={grade}>
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="sr-only">{TRUST_LABEL}: </span>
      {grade !== 'insufficient' && <strong className="tabular">{letter}</strong>}
      <span>{word}</span>
    </span>
  )
}
