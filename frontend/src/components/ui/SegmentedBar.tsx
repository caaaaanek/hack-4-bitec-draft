import { cn } from '@/lib/cn'

const FILL = {
  data: 'bg-data',
  culture: 'bg-cat-culture',
  system: 'bg-cat-system',
  accountability: 'bg-cat-accountability',
} as const

/** Сегментована смуга: заповнені сегменти кольору даних, решта сірі. Значення завжди є поруч текстом. */
export function SegmentedBar({
  value,
  max = 100,
  segments = 20,
  label,
  meter = false,
  tone = 'data',
  className,
}: {
  value: number
  max?: number
  segments?: number
  /** Текстовий опис для скрінрідерів, наприклад «Культура: 58 зі 100». */
  label: string
  /** true: семантика role="meter" (значення в межах 0-max), інакше зображення з підписом. */
  meter?: boolean
  /** Колір заповнених сегментів: дані або категорія компонента. */
  tone?: 'data' | 'culture' | 'system' | 'accountability'
  className?: string
}) {
  const filled = Math.round((Math.max(0, Math.min(value, max)) / max) * segments)
  return (
    <div
      role={meter ? 'meter' : 'img'}
      aria-label={label}
      aria-valuemin={meter ? 0 : undefined}
      aria-valuemax={meter ? max : undefined}
      aria-valuenow={meter ? value : undefined}
      className={cn('flex h-5 gap-[3px]', className)}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn('flex-1 rounded-[2px]', i < filled ? FILL[tone] : 'bg-surface-muted')}
        />
      ))}
    </div>
  )
}
