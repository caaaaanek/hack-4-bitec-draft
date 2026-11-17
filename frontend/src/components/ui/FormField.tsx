import { useId, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface FormFieldControlProps {
  id: string
  describedBy: string | undefined
  invalid: boolean
}

export interface FormFieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  htmlFor?: string
  className?: string
  children: ReactNode | ((props: FormFieldControlProps) => ReactNode)
}

export function FormField({
  label,
  hint,
  error,
  required = false,
  htmlFor,
  className,
  children,
}: FormFieldProps) {
  const autoId = useId()
  const id = htmlFor ?? autoId
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = `${id}-error`
  const describedBy = [hintId, error ? errorId : undefined].filter(Boolean).join(' ') || undefined
  const invalid = Boolean(error)

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-body font-medium text-text">
        {label}
        {required && (
          <>
            <span aria-hidden className="ml-1 text-text-muted">
              *
            </span>
            <span className="sr-only"> (обов’язкове поле)</span>
          </>
        )}
      </label>
      {hint && (
        <p id={hintId} className="text-caption text-text-muted">
          {hint}
        </p>
      )}
      {typeof children === 'function' ? children({ id, describedBy, invalid }) : children}
      <div id={errorId} aria-live="polite">
        {error && (
          <p className="flex items-start gap-1.5 text-caption text-critical-text">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </div>
  )
}
