export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium select-none touch-h ' +
  'transition-colors duration-150 ease-standard ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50'

export const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active',
  secondary:
    'bg-surface text-text border border-border hover:bg-surface-muted active:bg-surface-muted',
  ghost: 'bg-transparent text-accent hover:bg-accent-soft active:bg-accent-soft',
  danger:
    'bg-critical-bg text-critical-text border border-critical-solid/40 hover:brightness-95 active:brightness-90',
}

export const buttonSizes: Record<ButtonSize, string> = {
  sm: 'px-3 text-caption',
  md: 'px-4 text-body',
  lg: 'px-6 text-body-lg',
}
