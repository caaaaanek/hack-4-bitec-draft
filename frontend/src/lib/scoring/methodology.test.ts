import { describe, expect, it } from 'vitest'
import {
  COMPONENT_IDS,
  contributionOf,
  creditedOf,
  deltaOf,
  fmt,
  indexOf,
  levelOf,
  pointsText,
} from './methodology'

describe('levelOf', () => {
  it('межі рівнів', () => {
    expect(levelOf(0)).toBe(1)
    expect(levelOf(12.5)).toBe(1)
    expect(levelOf(12.6)).toBe(2)
    expect(levelOf(37.5)).toBe(2)
    expect(levelOf(37.6)).toBe(3)
    expect(levelOf(54.2)).toBe(3)
    expect(levelOf(62.5)).toBe(3)
    expect(levelOf(62.6)).toBe(4)
    expect(levelOf(87.5)).toBe(4)
    expect(levelOf(87.6)).toBe(5)
    expect(levelOf(100)).toBe(5)
  })
})

describe('creditedOf', () => {
  it('обмежувач 80/35 дає 60 з причиною', () => {
    const c = creditedOf(80, 35)
    expect(c.value).toBe(60)
    expect(c.limited).toBe(true)
    expect(c.reason).toContain('60')
  })
  it('не спрацьовує в межах запасу', () => {
    expect(creditedOf(57.5, 40)).toEqual({ value: 57.5, limited: false })
    expect(creditedOf(65, 40).limited).toBe(false)
  })
})

describe('індекс', () => {
  const credited = { culture: 57.5, system: 45, accountability: 60 }
  it('сума внесків дорівнює індексу', () => {
    const sum = COMPONENT_IDS.reduce((s, id) => s + contributionOf(credited[id]), 0)
    expect(indexOf(credited)).toBe(54.2)
    expect(Math.round(sum * 10) / 10).toBe(indexOf(credited))
  })
  it('попередні цикли', () => {
    expect(indexOf({ culture: 50, system: 41, accountability: 50 })).toBe(47)
    expect(indexOf({ culture: 44, system: 36, accountability: 43 })).toBe(41)
  })
  it('дельта', () => {
    expect(deltaOf(54.2, 47)).toBe(7.2)
  })
})

describe('форматування', () => {
  it('числа й пункти', () => {
    expect(fmt(54.2)).toBe('54,2')
    expect(fmt(40)).toBe('40')
    expect(pointsText(7.2)).toBe('7,2 пункта')
    expect(pointsText(1)).toBe('1 пункт')
    expect(pointsText(3)).toBe('3 пункти')
    expect(pointsText(5)).toBe('5 пунктів')
  })
})
