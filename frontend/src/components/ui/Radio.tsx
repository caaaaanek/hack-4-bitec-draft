import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  hint?: ReactNode
  invalid?: boolean
}

export function Radio({
  label,
  hint,
  invalid = false,
  className,
  id,
  disabled,
  ...rest
}: RadioProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const hintId = hint ? `${inputId}-hint` : undefined
  return (
    <label
      htmlFor={inputId}
      className={cn(
        'flex touch-target items-start gap-3 rounded-md py-2.5 text-body text-text',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <input
        {...rest}
        id={inputId}
        type="radio"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={[rest['aria-describedby'], hintId].filter(Boolean).join(' ') || undefined}
        className={cn(
          'mt-px size-5 shrink-0 accent-accent',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          invalid && 'outline outline-2 outline-critical-solid',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      />
      <span className="flex flex-col">
        <span>{label}</span>
        {hint && (
          <span id={hintId} className="text-caption text-text-muted">
            {hint}
          </span>
        )}
      </span>
    </label>
  )
}
