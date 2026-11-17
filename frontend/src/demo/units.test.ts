import { describe, expect, it } from 'vitest'
import { K_MIN_GROUP } from '@/lib/scoring/methodology'
import { resolveScope, unitResponses } from './units'

describe('resolveScope', () => {
  it('k = 5 за замовчуванням, як на бекенді', () => expect(K_MIN_GROUP).toBe(5))
  it('підрозділ А (12) показується сам', () => {
    const r = resolveScope('unit-a')
    expect(r.hidden).toBe(false)
    expect(r.unit.id).toBe('unit-a')
  })
  it('підрозділ Б (3) ховається, показано батьківський', () => {
    const r = resolveScope('unit-b')
    expect(r.hidden).toBe(true)
    expect(r.unit.name).toBe('Умовний військовий інститут «Альфа»')
  })
  it('рівно 5 показується, 4 ховається', () => {
    expect(resolveScope('unit-a', { ...unitResponses, 'unit-a': 5 }).hidden).toBe(false)
    expect(resolveScope('unit-a', { ...unitResponses, 'unit-a': 4 }).hidden).toBe(true)
  })
})
