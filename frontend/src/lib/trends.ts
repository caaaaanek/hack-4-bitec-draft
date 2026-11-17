/** Динаміка за циклами: зріз періоду, порівняння двох циклів, напрям зміни. */
import { COMPONENT_IDS, COMPONENT_LABELS, round1, type ComponentId } from './scoring/methodology'

export interface CyclePoint {
  cycle: string
  index: number
  components: Record<ComponentId, number>
}

export interface TrendEvent {
  id: string
  /** Подія сталася після цього циклу, до наступного. */
  afterCycle: string
  title: string
}

export type Direction = 'up' | 'down' | 'same'

export const directionOf = (delta: number): Direction =>
  delta > 0 ? 'up' : delta < 0 ? 'down' : 'same'

export const DIRECTION_WORD: Record<Direction, string> = {
  up: 'Зросло',
  down: 'Знизилось',
  same: 'Без змін',
}

/** Цикли від `from` до `to` включно (порядок як у серії; недійсні межі дають порожній список). */
export function sliceSeries(series: CyclePoint[], from: string, to: string): CyclePoint[] {
  const a = series.findIndex((p) => p.cycle === from)
  const b = series.findIndex((p) => p.cycle === to)
  if (a < 0 || b < 0 || a > b) return []
  return series.slice(a, b + 1)
}

export interface CompareRow {
  id: 'index' | ComponentId
  label: string
  before: number
  after: number
  delta: number
  direction: Direction
}

/** Порівняння двох циклів за індексом і компонентами. */
export function compareCycles(a: CyclePoint, b: CyclePoint): CompareRow[] {
  const row = (id: CompareRow['id'], label: string, before: number, after: number): CompareRow => {
    const delta = round1(after - before)
    return { id, label, before, after, delta, direction: directionOf(delta) }
  }
  return [
    row('index', 'Індекс доброчесності', a.index, b.index),
    ...COMPONENT_IDS.map((id) => row(id, COMPONENT_LABELS[id], a.components[id], b.components[id])),
  ]
}

/** Події в проміжку між циклами від `from` до `to`. */
export function eventsBetween(
  events: TrendEvent[],
  series: CyclePoint[],
  from: string,
  to: string,
): TrendEvent[] {
  const slice = sliceSeries(series, from, to).map((p) => p.cycle)
  return events.filter((e) => {
    const i = slice.indexOf(e.afterCycle)
    return i >= 0 && i < slice.length - 1
  })
}
