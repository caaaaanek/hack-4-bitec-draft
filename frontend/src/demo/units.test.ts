import { describe, expect, it } from 'vitest'
import { K_MIN_GROUP } from '@/lib/scoring/methodology'
import { resolveScope, unitResponses } from './units'

describe('resolveScope', () => {
  it('k = 10 за замовчуванням', () => expect(K_MIN_GROUP).toBe(10))
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
  it('рівно 10 показується, 9 ховається', () => {
    expect(resolveScope('unit-a', { ...unitResponses, 'unit-a': 10 }).hidden).toBe(false)
    expect(resolveScope('unit-a', { ...unitResponses, 'unit-a': 9 }).hidden).toBe(true)
  })
})
