import { useCallback, useState } from 'react'

export type Theme = 'dark' | 'light'

const KEY = 'iap-theme'

/** Поточна тема з атрибута на html (його ставить вбудований скрипт в index.html). Типова: світла. */
export function readTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* без збереження: тема діє до перезавантаження */
  }
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(readTheme)
  const toggle = useCallback(() => {
    const next: Theme = readTheme() === 'light' ? 'dark' : 'light'
    applyTheme(next)
    setTheme(next)
  }, [])
  return { theme, toggle }
}
