import { useMemo } from 'react'
import { allMeasures, applyDecisions } from '@/lib/decisions'
import { buildRecommendations } from '@/lib/recommendations'
import { measureSummary } from '@/lib/measures'
import { DEMO_MEASURES, TODAY } from './measures'
import { useDecisions } from './decisionsStore'
import { institutionById } from './institutions'

export interface NavCount {
  /** Текст лічильника в меню. */
  text: string
  /** Коротко для згорнутого меню. */
  short: string
  /** Повне пояснення для скрінрідерів і підказки. */
  label: string
}

/** Лічильники біля «Рекомендації» і «Трекер»: завжди текстом, не лише кольором. */
export function useNavCounts(): Record<string, NavCount> {
  const decisions = useDecisions()
  return useMemo(() => {
    const alpha = institutionById('alpha')
    const recs = applyDecisions(
      buildRecommendations({
        items: [...alpha.perceptionItems, ...alpha.factItems],
        flags: alpha.flags,
      }),
      decisions,
    )
    const open = recs.filter((r) => r.status === 'proposed' || r.status === 'clarified').length
    const m = measureSummary(allMeasures(DEMO_MEASURES, decisions), TODAY)
    return {
      '/recommendations': {
        text: String(open),
        short: String(open),
        label: `Рекомендацій без рішення: ${open}`,
      },
      '/tracker': {
        text: m.overdue > 0 ? `${m.total}, ${m.overdue} простр.` : String(m.total),
        short: String(m.total),
        label:
          m.overdue > 0
            ? `Заходів у трекері: ${m.total}, з них прострочено ${m.overdue}`
            : `Заходів у трекері: ${m.total}`,
      },
    }
  }, [decisions])
}
