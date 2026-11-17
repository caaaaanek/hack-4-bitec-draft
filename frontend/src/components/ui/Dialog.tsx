import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './IconButton'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[tabindex]',
  '[contenteditable="true"]',
].join(',')

/** Повертає елементи всередині контейнера, на які можна перейти клавішею Tab. */
// eslint-disable-next-line react-refresh/only-export-components
export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute('disabled')) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    if (el.hidden) return false
    if (el.tabIndex < 0) return false
    if (el instanceof HTMLInputElement && el.type === 'hidden') return false
    return true
  })
}

/** Індекс наступного елемента при циклічному переході Tab / Shift+Tab. */
// eslint-disable-next-line react-refresh/only-export-components
export function nextFocusIndex(current: number, total: number, shift: boolean): number {
  if (total <= 0) return -1
  if (current < 0 || current >= total) return shift ? total - 1 : 0
  return shift ? (current - 1 + total) % total : (current + 1) % total
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  /** «side»: висувна панель праворуч на всю висоту (на вузьких екранах на всю ширину). */
  variant?: 'center' | 'side'
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = 'center',
}: DialogProps) {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Початковий фокус, повернення фокусу, блокування прокрутки.
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    if (panel) {
      const [first] = getFocusable(panel)
      ;(first ?? panel).focus()
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      if (previous && previous.isConnected) previous.focus()
    }
  }, [open])

  if (!open) return null
  const side = variant === 'side'

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const items = getFocusable(panel)
    e.preventDefault()
    if (items.length === 0) {
      panel.focus()
      return
    }
    const current = items.indexOf(document.activeElement as HTMLElement)
    items[nextFocusIndex(current, items.length, e.shiftKey)]?.focus()
  }

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex',
        side ? 'justify-end' : 'items-end justify-center md:items-center md:p-6',
      )}
    >
      <div
        data-testid="dialog-backdrop"
        aria-hidden
        className="absolute inset-0 bg-text/50"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative flex w-full flex-col border border-border bg-surface text-text shadow-lg focus:outline-none',
          side
            ? 'h-dvh max-w-full border-l border-border sm:max-w-md md:max-w-xl'
            : 'max-h-[90vh] rounded-t-lg md:max-w-lg md:rounded-lg',
        )}
      >
        <div className="flex items-start justify-between gap-4 p-4 md:p-6 md:pb-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-card">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-body text-text-muted">
                {description}
              </p>
            )}
          </div>
          <IconButton label="Закрити" icon={<X className="size-5" />} onClick={onClose} />
        </div>
        {children && (
          <div
            className={cn('overflow-y-auto px-4 text-body md:px-6', side && 'min-h-0 flex-1 pb-4')}
          >
            {children}
          </div>
        )}
        {footer && (
          <div className="flex flex-col-reverse gap-2 p-4 sm:flex-row sm:justify-end md:p-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
