import { describe, expect, it } from 'vitest'
import { buildCompareRows } from './compare'
import { components, perceptionItems } from '@/demo/data'
import { INSTITUTIONS } from '@/demo/institutions'

describe('порівняння сприйняття й фактів', () => {
  it('Альфа: Підзвітність має розрив 45 і обмежувач, решта без обмежувача', () => {
    const rows = buildCompareRows(perceptionItems, components)
    const acc = rows.find((r) => r.component === 'accountability')!
    expect(acc).toMatchObject({ perception: 80, facts: 35, credited: 60, gap: 45, limited: true })
    expect(rows.filter((r) => r.limited)).toHaveLength(1)
  })

  it('середні за джерелами існують і лежать у 0-100 для всіх закладів', () => {
    for (const inst of INSTITUTIONS)
      for (const r of buildCompareRows(inst.perceptionItems, inst.components)) {
        for (const v of Object.values(r.bySource)) {
          expect(v).toBeGreaterThan(0)
          expect(v).toBeLessThanOrEqual(100)
        }
        expect(r.credited).toBeLessThanOrEqual(r.perception)
      }
  })
})
