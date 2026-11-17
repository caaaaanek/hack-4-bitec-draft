import { describe, expect, it } from 'vitest'
import { K_MIN_GROUP as MIN_GROUP_K } from './methodology'
import { trustGrade, type TrustFlag } from './trust'

const f = (weight: TrustFlag['weight'], raised: boolean) => ({ weight, raised })
const minors = (n: number) => Array.from({ length: n }, () => f('minor', true))

describe('trustGrade', () => {
  it('A: жоден прапорець не спрацював', () => {
    expect(trustGrade([], 20)).toBe('A')
    expect(trustGrade([f('major', false), f('minor', false)], 20)).toBe('A')
  })
  it('B: один або два незначних', () => {
    expect(trustGrade(minors(1), 20)).toBe('B')
    expect(trustGrade(minors(2), 20)).toBe('B')
  })
  it('C: серйозний або три і більше незначних', () => {
    expect(trustGrade([f('major', true)], 20)).toBe('C')
    expect(trustGrade([f('major', true), ...minors(2)], 20)).toBe('C')
    expect(trustGrade(minors(3), 20)).toBe('C')
    expect(trustGrade(minors(5), 20)).toBe('C')
  })
  it('недостатньо даних, якщо відповідей менше k', () => {
    expect(trustGrade([], MIN_GROUP_K - 1)).toBe('insufficient')
    expect(trustGrade([f('major', true)], 0)).toBe('insufficient')
    expect(trustGrade([], MIN_GROUP_K)).toBe('A')
  })
  it('k можна змінити', () => {
    expect(trustGrade([], 7, 8)).toBe('insufficient')
    expect(trustGrade([], 8, 8)).toBe('A')
  })
})
