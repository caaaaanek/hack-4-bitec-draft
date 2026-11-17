import { contrastRatio, normalizeHex } from './contrast'

describe('contrast', () => {
  it('black on white is 21', () => expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0))
  it('same colour is 1', () => expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5))
  it('normalizes short hex', () => expect(normalizeHex('#FfF')).toBe('#ffffff'))
  it('rejects non hex', () => expect(normalizeHex('rgb(0,0,0)')).toBeNull())
})
