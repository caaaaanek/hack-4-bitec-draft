import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { IconButton } from './IconButton'

/** Перемикач теми: світла основна; у темній темі показує сонце (перейти на світлу), у світлій місяць. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <IconButton
      data-print="hide"
      variant="secondary"
      className="!size-[38px] !min-h-0 !min-w-0 !rounded-[12px] !p-0"
      label={dark ? 'Увімкнути світлу тему' : 'Увімкнути темну тему'}
      aria-pressed={!dark}
      onClick={toggle}
      icon={dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    />
  )
}
