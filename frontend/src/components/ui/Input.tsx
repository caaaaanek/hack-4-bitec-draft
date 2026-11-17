import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export const controlBase =
  'w-full touch-h rounded-[10px] border border-border-strong bg-surface px-3 text-body text-text ' +
  'placeholder:text-text-muted hover:border-text-muted transition-colors duration-150 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border-strong'

export const controlInvalid = 'border-critical-solid hover:border-critical-solid'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export function Input({ invalid = false, className, type = 'text', ...rest }: InputProps) {
  return (
    <input
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(controlBase, invalid && controlInvalid, className)}
      {...rest}
    />
  )
}
