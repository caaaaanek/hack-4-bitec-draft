import type { ComponentPropsWithoutRef } from 'react'

export function VisuallyHidden({ className, ...rest }: ComponentPropsWithoutRef<'span'>) {
  return <span className={['sr-only', className].filter(Boolean).join(' ')} {...rest} />
}
