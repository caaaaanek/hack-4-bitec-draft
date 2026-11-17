import { cn } from '@/lib/cn'

/** Велике число: ціла частина темна, дробова (після коми) приглушена. Повне значення читається цілим. */
export function BigNumber({
  value,
  size = 'numeral',
  className,
}: {
  value: string
  size?: 'display' | 'numeral'
  className?: string
}) {
  const i = value.indexOf(',')
  const whole = i < 0 ? value : value.slice(0, i)
  const dec = i < 0 ? '' : value.slice(i)
  return (
    <span
      className={cn(
        size === 'display' ? 'text-display' : 'text-numeral',
        'tabular text-text',
        className,
      )}
    >
      <span className="sr-only">{value}</span>
      <span aria-hidden>
        {whole}
        {dec && <span className="text-text-muted">{dec}</span>}
      </span>
    </span>
  )
}
