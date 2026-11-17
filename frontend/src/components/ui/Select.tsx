import type { SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { controlBase, controlInvalid } from './Input'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
  wrapperClassName?: string
}

export function Select({
  invalid = false,
  className,
  wrapperClassName,
  disabled,
  children,
  ...rest
}: SelectProps) {
  return (
    <div className={cn('relative', wrapperClassName)}>
      <select
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={cn(controlBase, 'appearance-none pr-10', invalid && controlInvalid, className)}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className={cn(
          'pointer-events-none absolute right-3 top-1/2 size-5 -translate-y-1/2 text-text-muted',
          disabled && 'opacity-50',
        )}
      />
    </div>
  )
}
