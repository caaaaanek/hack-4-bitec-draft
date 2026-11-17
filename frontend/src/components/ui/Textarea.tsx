import type { TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { controlBase, controlInvalid } from './Input'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export function Textarea({ invalid = false, className, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(controlBase, 'py-2 resize-y', invalid && controlInvalid, className)}
      {...rest}
    />
  )
}
