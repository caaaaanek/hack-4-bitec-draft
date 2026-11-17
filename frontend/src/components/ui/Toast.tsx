/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertTriangle, CircleCheck, Info, OctagonAlert, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './IconButton'

export type ToastTone = 'info' | 'success' | 'attention' | 'error'

export interface ToastInput {
  title: string
  description?: string
  tone: ToastTone
}

interface ToastItem extends ToastInput {
  id: number
}

const TONES: Record<ToastTone, { icon: LucideIcon; classes: string; label: string }> = {
  info: { icon: Info, classes: 'bg-neutral-bg text-neutral-text', label: 'Інформація' },
  success: { icon: CircleCheck, classes: 'bg-strength-bg text-strength-text', label: 'Успіх' },
  attention: {
    icon: AlertTriangle,
    classes: 'bg-attention-bg text-attention-text',
    label: 'Увага',
  },
  error: { icon: OctagonAlert, classes: 'bg-critical-bg text-critical-text', label: 'Помилка' },
}

export const TOAST_DURATION_MS = 6000

interface ToastContextValue {
  push: (toast: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast потрібно викликати всередині ToastProvider')
  return ctx
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const { icon: Icon, classes, label } = TONES[toast.tone]
  const { id } = toast
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [id, onDismiss])

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border border-border p-3 shadow-lg',
        classes,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1 text-body">
        <p className="font-semibold">
          <span className="sr-only">{label}: </span>
          {toast.title}
        </p>
        {toast.description && <p className="mt-0.5">{toast.description}</p>}
      </div>
      <IconButton
        label="Закрити сповіщення"
        icon={<X className="size-4" />}
        onClick={() => onDismiss(id)}
      />
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((toast: ToastInput) => {
    const id = nextId.current++
    setToasts((list) => [...list, { ...toast, id }])
  }, [])

  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Сповіщення"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-60 flex flex-col gap-2 p-4 sm:inset-x-auto sm:right-0 sm:w-96"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
