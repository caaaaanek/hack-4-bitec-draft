import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { cn } from '@/lib/cn'
import { buttonBase, buttonSizes, buttonVariants } from './buttonStyles'
import { FORBIDDEN_TEXT } from './messages'

/** Стан 403: пояснює, що недоступно і що робити. Не картка помилки (немає role="alert"). */
export function ForbiddenState({ homeHref = '/' }: { homeHref?: string }) {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4 md:p-6"
    >
      <Lock aria-hidden className="mt-0.5 size-5 shrink-0 text-text-muted" />
      <div className="space-y-3">
        <p className="m-0 text-body">{FORBIDDEN_TEXT}</p>
        <Link
          to={homeHref}
          className={cn(buttonBase, buttonVariants.secondary, buttonSizes.md, 'no-underline')}
        >
          На головну
        </Link>
      </div>
    </div>
  )
}
