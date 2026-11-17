import { useEffect, useId, useRef, useState } from 'react'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui'
import { ROLE_LABELS } from '@/lib/access'
import { useSession } from '@/api/session'
import { roleInitials } from './roleInitials'

const CATEGORY_LABEL: Record<string, string> = {
  working_group: 'робоча група',
  staff: 'особовий склад',
  expert: 'зовнішній експерт',
}

/** Кнопка користувача з випадною панеллю: хто увійшов, роль, вихід. */
export function UserMenu() {
  const { user, role, logout } = useSession()
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btn.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!user) return null
  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Обліковий запис: ${user.display_name}, ${ROLE_LABELS[role]}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-[38px] items-center justify-center rounded-full bg-accent-soft text-caption font-bold text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {roleInitials(ROLE_LABELS[role])}
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Обліковий запис"
          className="fixed inset-x-2 top-16 z-40 rounded-lg border border-border bg-surface p-4 shadow-lg md:absolute md:inset-x-auto md:top-full md:right-0 md:mt-2 md:w-80"
        >
          <p className="m-0 text-card">{user.display_name}</p>
          <p className="m-0 mt-1 text-caption text-text-muted">
            Логін {user.login} · {ROLE_LABELS[role]}
            {user.category ? ` · ${CATEGORY_LABEL[user.category] ?? user.category}` : ''}
          </p>
          <div className="mt-3 border-t border-border pt-3">
            <Button
              variant="secondary"
              leftIcon={<LogOut aria-hidden className="size-4" />}
              onClick={() => {
                setOpen(false)
                void logout()
              }}
            >
              Вийти
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
