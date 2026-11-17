import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * Підказка. УВАГА: суттєва інформація ніколи не має жити лише в підказці,
 * бо її не побачать на сенсорних екранах і при швидкому перегляді. Підказка
 * лише доповнює видимий текст або підпис.
 */
export interface TooltipProps {
  content: ReactNode
  children: ReactNode
  /** Куди розкривається підказка; «bottom» для елементів біля верху екрана. */
  placement?: 'top' | 'bottom'
}

export function Tooltip({ content, children, placement = 'top' }: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const pointerDown = useRef(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setPinned(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <span className="relative inline-flex">
      <span
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        className="inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          if (!pinned) setOpen(false)
        }}
        onMouseDown={() => {
          pointerDown.current = true
        }}
        onFocus={() => {
          // Під час кліку відкриттям керує обробник click.
          if (!pointerDown.current) setOpen(true)
          pointerDown.current = false
        }}
        onBlur={() => {
          setOpen(false)
          setPinned(false)
        }}
        onClick={() => {
          const next = !pinned
          setPinned(next)
          setOpen(next || open)
          if (!next) setOpen(false)
        }}
      >
        {children}
      </span>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute left-1/2 z-40 w-max max-w-64 -translate-x-1/2 rounded-md bg-text px-3 py-2 text-caption text-surface shadow-md ${placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
        >
          {content}
        </span>
      )}
    </span>
  )
}
