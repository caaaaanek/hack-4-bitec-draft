import { describe, expect, it } from 'vitest'
import { COMPONENT_IDS, weightedMean } from '@/lib/scoring/methodology'
import {
  components,
  currentIndex,
  factItems,
  perceptionItems,
  trustFlags,
  trustSummary,
} from './data'

describe('демо-дані', () => {
  it('індекс 54,2, факти 40/55/35, зараховане Підзвітності 60 з обмеженням', () => {
    expect(currentIndex).toBe(54.2)
    const byId = Object.fromEntries(components.map((c) => [c.id, c]))
    expect([byId.culture!.facts, byId.system!.facts, byId.accountability!.facts]).toEqual([
      40, 55, 35,
    ])
    expect(byId.culture!.perception).toBe(57.5)
    expect(byId.accountability!.credited).toMatchObject({ value: 60, limited: true })
  })
  it('ваги питань і показників у межах компонента дають 100', () => {
    for (const id of COMPONENT_IDS)
      for (const items of [perceptionItems, factItems]) {
        const own = items.filter((i) => i.component === id)
        expect(own.length).toBeGreaterThanOrEqual(3)
        expect(own.reduce((s, i) => s + i.weight, 0)).toBe(100)
        expect(weightedMean(own)).toBeGreaterThan(0)
      }
  })
  it('факти містять чотири відсотки з назвами за рішенням команди', () => {
    const labels = factItems.map((i) => i.label)
    for (const l of [
      'Подано декларацій вчасно серед зобовʼязаних',
      'Потенційні конфлікти інтересів, за якими уповноважений дав висновок у строк',
      'Прапорці, за якими прийнято рішення або захід протягом 30 днів',
      'Скарги й звернення, розглянуті в строк',
    ])
      expect(labels).toContain(l)
  })
  it('достовірність C: один серйозний і один незначний прапорці', () => {
    expect(trustSummary.grade).toBe('C')
    expect(trustSummary.raised.map((f) => f.weight).sort()).toEqual(['major', 'minor'])
    expect(trustFlags.every((f) => f.explanation.length > 0)).toBe(true)
  })
})

describe('кількості фактів', () => {
  it('відсоток дорівнює numerator / denominator, текст «87 з 100 (87%)»', async () => {
    const { FACT_COUNTS, countText } = await import('./data')
    for (const c of Object.values(FACT_COUNTS))
      expect(Math.abs(c.percent - (c.numerator / c.denominator) * 100)).toBeLessThan(0.1)
    expect(countText({ numerator: 87, denominator: 100, percent: 87 })).toBe('87 з 100 (87%)')
  })
})
