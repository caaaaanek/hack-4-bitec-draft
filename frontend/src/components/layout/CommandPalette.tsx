import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { Dialog } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { Role } from '@/lib/access'
import { navFor } from './nav'

/** Палітра команд: пошук по назвах сторінок меню, доступних ролі. Стрілки, Enter переходить, Esc закриває. */
export function CommandPalette({
  open,
  onClose,
  role,
}: {
  open: boolean
  onClose: () => void
  role: Role
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return navFor(role).filter((i) => !q || i.label.toLowerCase().includes(q))
  }, [role, query])
  const current = Math.min(active, Math.max(items.length - 1, 0))

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  const go = (to: string) => {
    onClose()
    setQuery('')
    setActive(0)
    navigate(to)
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        setQuery('')
        setActive(0)
        onClose()
      }}
      title="Пошук по сторінках"
    >
      <div className="pb-4">
        <label className="flex items-center gap-2 rounded-[12px] bg-surface-muted px-3">
          <Search aria-hidden className="size-4 shrink-0 text-text-muted" />
          <span className="sr-only">Назва сторінки</span>
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={items[current] ? `palette-${current}` : undefined}
            placeholder="Назва сторінки"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive(Math.min(current + 1, items.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive(Math.max(current - 1, 0))
              } else if (e.key === 'Enter' && items[current]) {
                e.preventDefault()
                go(items[current]!.to)
              }
            }}
            className="h-10 w-full border-0 bg-transparent text-body text-text outline-none placeholder:text-text-muted"
          />
        </label>
        <ul
          id="palette-list"
          role="listbox"
          aria-label="Сторінки"
          className="m-0 mt-2 flex list-none flex-col gap-0.5 p-0"
        >
          {items.map(({ to, label, icon: Icon }, i) => (
            <li
              key={to}
              id={`palette-${i}`}
              role="option"
              aria-selected={i === current}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(to)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 text-body',
                i === current ? 'bg-surface-muted text-text' : 'text-text-muted',
              )}
            >
              <Icon aria-hidden className="size-[18px] shrink-0" />
              <span className="flex-1">{label}</span>
              {i === current && <CornerDownLeft aria-hidden className="size-4" />}
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-3 py-2.5 text-body text-text-muted">Нічого не знайдено</li>
          )}
        </ul>
      </div>
    </Dialog>
  )
}
