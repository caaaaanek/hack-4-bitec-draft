import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { readTheme, useTheme } from './theme'

describe('тема', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    localStorage.clear()
  })

  it('за замовчуванням світла', () => {
    expect(readTheme()).toBe('light')
  })

  it('перемикає, ставить атрибут і запамʼятовує вибір', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.toggle())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('iap-theme')).toBe('dark')
    act(() => result.current.toggle())
    expect(result.current.theme).toBe('light')
  })
})
