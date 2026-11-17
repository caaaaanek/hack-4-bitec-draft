import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { buttonBase, buttonVariants, type ButtonVariant } from './buttonStyles'

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  /** Обов'язковий підпис для скрінрідерів і підказки. */
  label: string
  icon: ReactNode
  variant?: ButtonVariant
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(buttonBase, buttonVariants[variant], 'touch-target p-2', className)}
      {...rest}
    >
      <span aria-hidden className="inline-flex">
        {icon}
      </span>
    </button>
  )
}
