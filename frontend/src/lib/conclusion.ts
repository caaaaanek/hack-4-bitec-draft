/** Короткий управлінський висновок (шаблонний текст) за даними закладу. */
import { MATURITY } from '@/components/ui/config'
import { TRUST_GRADE_TEXT } from '@/components/ui/messages'
import {
  COMPONENT_LABELS,
  fmt,
  fmtIndex,
  pointsText,
  type Credited,
  type ComponentId,
} from './scoring/methodology'
import type { MaturityLevel } from '@/components/ui/config'
import type { TrustGrade } from './scoring/trust'

export interface ConclusionInput {
  index: number
  level: MaturityLevel
  delta: number
  components: { id: ComponentId; perception: number; facts: number; credited: Credited }[]
  trustGrade: TrustGrade
}

export function buildConclusion(d: ConclusionInput): string {
  const change =
    d.delta > 0
      ? `що на ${pointsText(d.delta)} вище, ніж у попередньому циклі`
      : d.delta < 0
        ? `що на ${pointsText(d.delta)} нижче, ніж у попередньому циклі`
        : 'що не змінилося порівняно з попереднім циклом'
  const parts = [
    `Заклад перебуває на рівні зрілості ${d.level} «${MATURITY[d.level].name}»: індекс доброчесності ${fmtIndex(d.index)} з 100, ${change}.`,
  ]
  const limited = d.components.find((c) => c.credited.limited)
  if (limited) {
    parts.push(
      `Для компонента «${COMPONENT_LABELS[limited.id]}» сприйняття (${fmt(limited.perception)}) помітно вище за факти (${fmt(limited.facts)}), тому зараховано ${fmt(limited.credited.value)}.`,
    )
  }
  const t = TRUST_GRADE_TEXT[d.trustGrade]
  const word = t.word.toLowerCase()
  parts.push(
    d.trustGrade === 'A'
      ? `Достовірність ${t.letter}: ${word}.`
      : `Достовірність ${t.letter}: ${word}, тож спершу варто підтвердити факти документами.`,
  )
  return parts.join(' ')
}
