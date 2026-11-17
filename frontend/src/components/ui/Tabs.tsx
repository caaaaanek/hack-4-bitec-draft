import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface TabItem {
  id: string
  label: ReactNode
  content: ReactNode
}

export interface TabsProps {
  items: TabItem[]
  value?: string
  defaultValue?: string
  onValueChange?: (id: string) => void
  'aria-label'?: string
  className?: string
}

export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  'aria-label': ariaLabel,
  className,
}: TabsProps) {
  const uid = useId()
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id ?? '')
  const current = value ?? inner
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const select = (id: string, focus = false) => {
    if (value === undefined) setInner(id)
    onValueChange?.(id)
    if (focus) refs.current[id]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1
    if (e.key === 'ArrowRight') next = (index + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next < 0) return
    e.preventDefault()
    const target = items[next]
    if (target) select(target.id, true)
  }

  const tabId = (id: string) => `${uid}-tab-${id}`
  const panelId = (id: string) => `${uid}-panel-${id}`

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[12px] bg-surface-muted p-[3px]"
      >
        {items.map((item, i) => {
          const selected = item.id === current
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[item.id] = el
              }}
              type="button"
              role="tab"
              id={tabId(item.id)}
              aria-selected={selected}
              aria-controls={panelId(item.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(item.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'touch-h shrink-0 whitespace-nowrap rounded-[10px] px-4 text-body transition-colors duration-150 ease-standard',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                selected
                  ? 'bg-surface font-medium text-text shadow-md'
                  : 'text-text-muted hover:text-text',
              )}
            >
              {item.label}
            </button>
          )
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={panelId(item.id)}
          aria-labelledby={tabId(item.id)}
          hidden={item.id !== current}
          tabIndex={0}
          className="pt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {item.id === current ? item.content : null}
        </div>
      ))}
    </div>
  )
}
