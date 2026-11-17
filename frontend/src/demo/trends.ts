/** Динаміка: цикли з індексом, компонентами та подіями між циклами. */
import { history, CYCLE, currentCredited } from './data'
import { indexOf, type ComponentId } from '@/lib/scoring/methodology'
import type { CyclePoint, TrendEvent } from '@/lib/trends'

export const alphaSeries = (): CyclePoint[] => [
  ...history.map((h) => ({ cycle: h.cycle, index: indexOf(h.credited), components: h.credited })),
  {
    cycle: CYCLE,
    index: indexOf(currentCredited),
    components: currentCredited as Record<ComponentId, number>,
  },
]

/** Виконані заходи між циклами. */
export const alphaEvents: TrendEvent[] = [
  {
    id: 'ev-1',
    afterCycle: '2025-06',
    title: 'Виконано захід: пам’ятка з правил доброчесності',
  },
  {
    id: 'ev-2',
    afterCycle: '2025-12',
    title: 'Виконано захід: канал анонімних звернень',
  },
  {
    id: 'ev-3',
    afterCycle: '2026-06',
    title: 'Виконано захід: навчання для кураторів груп',
  },
]
