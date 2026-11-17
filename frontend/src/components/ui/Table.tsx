import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Card } from './Card'
import { Input } from './Input'
import { nextSortDir, sortRows, type SortDir, type SortValue } from './tableSort'

export interface TableColumn<T> {
  key: string
  header: string
  sortable?: boolean
  render?: (row: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  numeric?: boolean
  /** Рядок фільтрів у шапці: текстовий фільтр за значенням колонки. */
  filterable?: boolean
}

export interface TableProps<T> {
  columns: TableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  caption: string
  captionVisible?: boolean
  defaultSort?: { key: string; dir: SortDir }
  className?: string
  /** Закріплені заголовки: висота області прокрутки на широких екранах. */
  stickyMaxHeight?: string
}

const ariaSortOf = (dir: SortDir) =>
  dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'

const DIR_LABEL: Record<SortDir, string> = {
  asc: 'за зростанням',
  desc: 'за спаданням',
  none: 'без сортування',
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  caption,
  captionVisible = false,
  defaultSort,
  className,
  stickyMaxHeight,
}: TableProps<T>) {
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>(
    defaultSort ?? { key: '', dir: 'none' },
  )

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v.trim() !== '')
    if (active.length === 0) return rows
    return rows.filter((row) =>
      active.every(([k, v]) =>
        String((row as Record<string, unknown>)[k] ?? '')
          .toLowerCase()
          .includes(v.trim().toLowerCase()),
      ),
    )
  }, [rows, filters])

  const sorted = useMemo(
    () =>
      sort.dir === 'none'
        ? filtered
        : sortRows(filtered, sort.key, sort.dir, (row, k) => {
            const v = (row as Record<string, unknown>)[k]
            return (typeof v === 'number' || typeof v === 'string' ? v : null) as SortValue
          }),
    [filtered, sort],
  )

  const toggle = (key: string) => {
    const dir = sort.key === key ? nextSortDir(sort.dir) : 'asc'
    setSort({ key, dir })
  }

  const dirOf = (key: string): SortDir => (sort.key === key ? sort.dir : 'none')
  const cell = (col: TableColumn<T>, row: T): ReactNode =>
    col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')
  const alignClass = (col: TableColumn<T>) =>
    col.numeric || col.align === 'right'
      ? 'text-right'
      : col.align === 'center'
        ? 'text-center'
        : 'text-left'

  const sortableCols = columns.filter((c) => c.sortable)
  const filterCols = columns.filter((c) => c.filterable)

  return (
    <div className={className}>
      {/* Вузькі ширини: сортування над списком карток */}
      {sortableCols.length > 0 && (
        <div
          role="group"
          aria-label={`Сортування: ${caption}`}
          className="mb-3 flex flex-wrap gap-2 md:hidden"
        >
          {sortableCols.map((col) => {
            const dir = dirOf(col.key)
            const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => toggle(col.key)}
                aria-pressed={dir !== 'none'}
                aria-label={`Сортувати: ${col.header}, ${DIR_LABEL[dir]}`}
                className={cn(
                  'touch-h inline-flex items-center gap-1 rounded-md border border-border-strong bg-surface px-3 text-caption text-text',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  dir !== 'none' && 'font-semibold',
                )}
              >
                {col.header}
                <Icon aria-hidden className="size-4" />
              </button>
            )
          })}
        </div>
      )}

      {filterCols.length > 0 && (
        <div role="group" aria-label={`Фільтри: ${caption}`} className="mb-3 grid gap-2 md:hidden">
          {filterCols.map((col) => (
            <Input
              key={col.key}
              type="search"
              aria-label={`Фільтр: ${col.header}`}
              placeholder={col.header}
              value={filters[col.key] ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
            />
          ))}
        </div>
      )}

      <ul className="m-0 flex list-none flex-col gap-3 p-0 md:hidden" aria-label={caption}>
        {sorted.map((row) => (
          <li key={rowKey(row)}>
            <Card as="div" className="p-4">
              <dl className="m-0 flex flex-col gap-2">
                {columns.map((col) => (
                  <div key={col.key} className="flex justify-between gap-4">
                    <dt className="text-caption text-text-muted">{col.header}:</dt>
                    <dd
                      className={cn(
                        'm-0 text-body text-text',
                        col.numeric && 'tabular-nums text-right',
                      )}
                    >
                      {cell(col, row)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          </li>
        ))}
      </ul>

      <div
        className="hidden overflow-auto rounded-lg border border-border bg-surface p-2 md:block"
        style={stickyMaxHeight ? { maxHeight: stickyMaxHeight } : undefined}
      >
        <table className="hidden w-full border-collapse text-body md:table">
          <caption className={captionVisible ? 'p-3 text-left text-card text-text' : 'sr-only'}>
            {caption}
          </caption>
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map((col) => {
                const dir = dirOf(col.key)
                const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={col.sortable ? ariaSortOf(dir) : undefined}
                    className={cn(
                      'bg-surface-muted px-3 py-2.5 text-fine font-medium text-text-muted first:rounded-l-[10px] last:rounded-r-[10px]',
                      alignClass(col),
                    )}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggle(col.key)}
                        className={cn(
                          'touch-h inline-flex items-center gap-1 rounded-sm font-semibold',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                          (col.numeric || col.align === 'right') && 'flex-row-reverse',
                        )}
                      >
                        {col.header}
                        <Icon aria-hidden className="size-4" />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                )
              })}
            </tr>
            {filterCols.length > 0 && (
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className="bg-surface-muted px-3 py-1.5 first:rounded-l-[10px] last:rounded-r-[10px]"
                  >
                    {col.filterable ? (
                      <Input
                        type="search"
                        aria-label={`Фільтр: ${col.header}`}
                        placeholder="Фільтр"
                        value={filters[col.key] ?? ''}
                        onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                      />
                    ) : (
                      <span className="sr-only">Без фільтра</span>
                    )}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-border transition-colors last:border-b-0 hover:bg-surface-muted/60"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-3 py-3 text-text',
                      alignClass(col),
                      col.numeric && 'tabular-nums',
                    )}
                  >
                    {cell(col, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
