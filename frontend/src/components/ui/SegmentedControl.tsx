import { cn } from '@/lib/cn'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: React.ReactNode
}

/** Сегмент-перемикач: сірий жолоб, активний сегмент білий. Кнопки з aria-pressed, група підписана. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T
  options: SegmentOption<T>[]
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex gap-0.5 rounded-[12px] bg-surface-muted p-[3px]', className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'touch-h inline-flex items-center gap-1.5 rounded-[10px] px-3.5 text-body whitespace-nowrap transition-colors',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            value === o.value
              ? 'bg-surface font-medium text-text shadow-md'
              : 'text-text-muted hover:text-text',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}
