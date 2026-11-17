import { useEffect, useId, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button, Radio } from '@/components/ui'
import { ROLES, ROLE_LABELS } from '@/lib/access'
import { DEMO_UNITS, useDemo } from '@/demo/demoContext'
import { roleInitials } from './roleInitials'

/** Компактна кнопка «Демо» з випадною панеллю: роль, підрозділ респондента, скидання. */
export function DemoPanel() {
  const { role, unitId, setRole, setUnitId, resetDemo } = useDemo()
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

  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Демо. Роль: ${ROLE_LABELS[role]}`}
        title={`Демо. Роль: ${ROLE_LABELS[role]}. Усі дані на екрані синтетичні`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-[38px] items-center justify-center rounded-full bg-accent-soft text-caption font-bold text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {roleInitials(ROLE_LABELS[role])}
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Демо-панель"
          className="fixed inset-x-2 top-16 z-40 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-lg md:absolute md:inset-x-auto md:top-full md:right-0 md:mt-2 md:w-96"
        >
          <p className="m-0 text-caption text-text-muted">
            Усі дані синтетичні. Зміна ролі веде на її головний екран.
          </p>
          <fieldset className="m-0 mt-3 border-0 p-0">
            <legend className="text-card">Роль</legend>
            <div role="radiogroup" aria-label="Роль" className="mt-1">
              {ROLES.map((r) => (
                <Radio
                  key={r}
                  name="demo-role"
                  value={r}
                  label={ROLE_LABELS[r]}
                  checked={role === r}
                  onChange={() => {
                    setRole(r)
                    setOpen(false)
                  }}
                />
              ))}
            </div>
          </fieldset>
          {role === 'respondent' && (
            <fieldset className="m-0 mt-3 border-0 border-t border-border p-0 pt-3">
              <legend className="text-card">Підрозділ респондента</legend>
              <div role="radiogroup" aria-label="Підрозділ респондента" className="mt-1">
                {DEMO_UNITS.map((u) => (
                  <Radio
                    key={u.id}
                    name="demo-unit"
                    value={u.id}
                    label={u.label}
                    hint={u.note}
                    checked={unitId === u.id}
                    onChange={() => setUnitId(u.id)}
                  />
                ))}
              </div>
            </fieldset>
          )}
          <div className="mt-3 border-t border-border pt-3">
            <Button
              variant="secondary"
              leftIcon={<RotateCcw aria-hidden className="size-4" />}
              onClick={() => {
                resetDemo()
                setOpen(false)
              }}
            >
              Скинути демо-дані
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
