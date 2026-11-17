export type SortDir = 'asc' | 'desc' | 'none'

export type SortValue = number | string | null | undefined

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))
}

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'uk', { numeric: true })
}

export function sortRows<T>(
  rows: readonly T[],
  key: string,
  dir: SortDir,
  getValue: (row: T, key: string) => SortValue = (row, k) =>
    (row as Record<string, unknown>)[k] as SortValue,
): T[] {
  if (dir === 'none') return [...rows]
  const sign = dir === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: getValue(row, key) }))
    .sort((a, b) => {
      const ae = isEmpty(a.value)
      const be = isEmpty(b.value)
      if (ae || be) {
        if (ae && be) return a.index - b.index
        return ae ? 1 : -1
      }
      const c = compare(a.value, b.value) * sign
      return c !== 0 ? c : a.index - b.index
    })
    .map((x) => x.row)
}

export function nextSortDir(current: SortDir): SortDir {
  if (current === 'none') return 'asc'
  if (current === 'asc') return 'desc'
  return 'none'
}
