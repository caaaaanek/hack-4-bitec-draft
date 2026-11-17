/** Порівняння сприйняття й фактів: середні за джерелами (РГ, ОС, експерти) і факти по компонентах. */
import {
  COMPONENT_IDS,
  LIMITER_MARGIN,
  round1,
  weightedMean,
  type ComponentId,
} from './scoring/methodology'

export type SourceKey = 'wg' | 'os' | 'experts'

interface Item {
  component: ComponentId
  weight: number
  value: number
  source: string
}

export interface CompareRow {
  component: ComponentId
  /** Середнє питань за кожним джерелом сприйняття. */
  bySource: Record<SourceKey, number>
  perception: number
  facts: number
  credited: number
  /** Сприйняття мінус факти, пункти. */
  gap: number
  /** Розрив більший за поріг обмежувача. */
  limited: boolean
}

const mean = (items: Item[]): number => (items.length ? weightedMean(items) : 0)

/** Один ряд на компонент. `components` це результати розрахунку (сприйняття, факти, зараховане). */
export function buildCompareRows(
  perceptionItems: Item[],
  components: { id: ComponentId; perception: number; facts: number; credited: { value: number } }[],
): CompareRow[] {
  return COMPONENT_IDS.map((id) => {
    const c = components.find((x) => x.id === id)!
    const own = perceptionItems.filter((i) => i.component === id)
    const src = (s: SourceKey) => round1(mean(own.filter((i) => i.source === s)))
    const gap = round1(c.perception - c.facts)
    return {
      component: id,
      bySource: { wg: src('wg'), os: src('os'), experts: src('experts') },
      perception: c.perception,
      facts: c.facts,
      credited: c.credited.value,
      gap,
      limited: gap > LIMITER_MARGIN,
    }
  })
}
