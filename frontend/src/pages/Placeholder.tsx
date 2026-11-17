import { PageTitle } from '@/components/layout/PageTitle'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { EmptyState, buttonBase, buttonSizes, buttonVariants } from '@/components/ui'
import { cn } from '@/lib/cn'
import { defaultRoute } from '@/lib/access'
import { useDemo } from '@/demo/demoContext'

export interface PlaceholderProps {
  title: string
  description: string
  /** Додаткова примітка (наприклад, про межі доступу ролі). */
  note?: ReactNode
}

/** Заглушка майбутнього розділу: пояснює, що тут буде. */
export function Placeholder({ title, description, note }: PlaceholderProps) {
  const { role } = useDemo()
  return (
    <div data-ready="true" className="space-y-4">
      <PageTitle>{title}</PageTitle>
      <EmptyState
        title="Розділ готується"
        description={description}
        action={
          <Link
            to={defaultRoute(role)}
            className={cn(buttonBase, buttonVariants.secondary, buttonSizes.md, 'no-underline')}
          >
            На мій головний екран
          </Link>
        }
      />
      {note && <p className="m-0 max-w-(--prose-max) text-body text-text-muted">{note}</p>}
    </div>
  )
}
