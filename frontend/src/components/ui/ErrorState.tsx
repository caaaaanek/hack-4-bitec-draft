import type { ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from './Button'

export interface ErrorStateProps {
  title?: string
  description: string
  whatToDo: ReactNode
  onRetry?: () => void
}

export function ErrorState({
  title = 'Не вдалося завантажити дані',
  description,
  whatToDo,
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-lg border border-border border-l-4 border-l-critical-solid bg-surface p-4 md:p-6"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-6 shrink-0 text-critical-solid" />
      <div className="flex flex-col gap-2 text-text">
        <p className="m-0 text-card">{title}</p>
        <p className="m-0 text-body">{description}</p>
        <p className="m-0 text-body">
          <span className="font-semibold">Що зробити:</span> {whatToDo}
        </p>
        {onRetry && (
          <div>
            <Button
              variant="secondary"
              leftIcon={<RefreshCw aria-hidden className="size-4" />}
              onClick={onRetry}
            >
              Спробувати ще раз
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
