import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Table, type TableColumn } from './Table'
import { ChangeChip } from './KpiTile'
import { Tabs } from './Tabs'
import { ErrorState } from './ErrorState'
import { HiddenGroupState } from './HiddenGroupState'
import { nextSortDir, sortRows } from './tableSort'

describe('sortRows', () => {
  it('sorts numbers asc/desc', () => {
    const rows = [{ v: 3 }, { v: 1 }, { v: 2 }]
    expect(sortRows(rows, 'v', 'asc').map((r) => r.v)).toEqual([1, 2, 3])
    expect(sortRows(rows, 'v', 'desc').map((r) => r.v)).toEqual([3, 2, 1])
  })
  it('sorts Ukrainian strings by locale', () => {
    const rows = [{ v: 'Яблуко' }, { v: 'Їжак' }, { v: 'Іра' }, { v: 'Анна' }]
    expect(sortRows(rows, 'v', 'asc').map((r) => r.v)).toEqual(['Анна', 'Іра', 'Їжак', 'Яблуко'])
  })
  it('puts null/undefined last in both directions', () => {
    const rows = [{ v: null }, { v: 2 }, { v: undefined }, { v: 1 }] as {
      v: number | null | undefined
    }[]
    expect(sortRows(rows, 'v', 'asc').map((r) => r.v)).toEqual([1, 2, null, undefined])
    expect(sortRows(rows, 'v', 'desc').map((r) => r.v)).toEqual([2, 1, null, undefined])
  })
  it('is stable and returns a copy for none', () => {
    const rows = [
      { id: 'a', v: 1 },
      { id: 'b', v: 1 },
      { id: 'c', v: 0 },
    ]
    expect(sortRows(rows, 'v', 'asc').map((r) => r.id)).toEqual(['c', 'a', 'b'])
    const none = sortRows(rows, 'v', 'none')
    expect(none).toEqual(rows)
    expect(none).not.toBe(rows)
  })
  it('supports custom getValue', () => {
    const rows = [{ n: { x: 2 } }, { n: { x: 1 } }]
    expect(sortRows(rows, 'n', 'asc', (r) => r.n.x)[0]).toBe(rows[1])
  })
})

describe('nextSortDir', () => {
  it('cycles asc -> desc -> none', () => {
    expect(nextSortDir('none')).toBe('asc')
    expect(nextSortDir('asc')).toBe('desc')
    expect(nextSortDir('desc')).toBe('none')
  })
})

interface Row {
  id: string
  name: string
  score: number
}
const columns: TableColumn<Row>[] = [
  { key: 'name', header: 'Назва', sortable: true },
  { key: 'score', header: 'Бал', sortable: true, numeric: true },
]
const data: Row[] = [
  { id: '1', name: 'Бета', score: 2 },
  { id: '2', name: 'Альфа', score: 3 },
  { id: '3', name: 'Гама', score: 1 },
]

describe('Table', () => {
  it('sorts on header click and updates aria-sort', async () => {
    const user = userEvent.setup()
    render(<Table columns={columns} rows={data} rowKey={(r) => r.id} caption="Тест" />)
    const table = screen.getByRole('table', { hidden: true })
    const th = within(table).getByRole('columnheader', { name: /Назва/, hidden: true })
    expect(th).toHaveAttribute('aria-sort', 'none')
    const names = () =>
      within(table)
        .getAllByRole('row', { hidden: true })
        .slice(1)
        .map((r) => within(r).getAllByRole('cell', { hidden: true })[0]?.textContent)
    expect(names()).toEqual(['Бета', 'Альфа', 'Гама'])

    const btn = within(th).getByRole('button', { hidden: true })
    await user.click(btn)
    expect(th).toHaveAttribute('aria-sort', 'ascending')
    expect(names()).toEqual(['Альфа', 'Бета', 'Гама'])
    await user.click(btn)
    expect(th).toHaveAttribute('aria-sort', 'descending')
    expect(names()).toEqual(['Гама', 'Бета', 'Альфа'])
    await user.click(btn)
    expect(th).toHaveAttribute('aria-sort', 'none')
    expect(names()).toEqual(['Бета', 'Альфа', 'Гама'])
  })
})

describe('Tabs', () => {
  const items = [
    { id: 'a', label: 'Перша', content: <p>Зміст A</p> },
    { id: 'b', label: 'Друга', content: <p>Зміст B</p> },
    { id: 'c', label: 'Третя', content: <p>Зміст C</p> },
  ]

  it('has correct aria and roving tabindex', () => {
    render(<Tabs items={items} aria-label="Розділи" />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
    const panel = screen.getByRole('tabpanel')
    expect(tabs[0]?.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel).toHaveTextContent('Зміст A')
  })

  it('navigates with arrows, Home and End', async () => {
    const user = userEvent.setup()
    render(<Tabs items={items} />)
    const tabs = screen.getAllByRole('tab')
    tabs[0]?.focus()
    await user.keyboard('{ArrowRight}')
    expect(tabs[1]).toHaveFocus()
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')
    expect(tabs[2]).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(tabs[0]).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(tabs[2]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(tabs[0]).toHaveFocus()
  })

  it('works controlled', async () => {
    const user = userEvent.setup()
    function Wrapper() {
      const [v, setV] = useState('b')
      return <Tabs items={items} value={v} onValueChange={setV} />
    }
    render(<Wrapper />)
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Зміст B')
    await user.click(screen.getByRole('tab', { name: 'Третя' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Зміст C')
  })
})

describe('states', () => {
  it('HiddenGroupState shows exact text', () => {
    render(<HiddenGroupState />)
    expect(screen.getByRole('note')).toHaveTextContent(
      'Недостатньо відповідей, щоб показати результати цієї групи. Показано дані рівня вище. Це захищає анонімність учасників.',
    )
  })
  it('ErrorState has role alert, default title and hint', async () => {
    const onRetry = vi.fn()
    render(
      <ErrorState
        description="Сервер не відповів."
        whatToDo="Перевірте з'єднання."
        onRetry={onRetry}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Не вдалося завантажити дані')
    expect(alert).toHaveTextContent('Що зробити:')
    await userEvent.click(screen.getByRole('button', { name: /Спробувати/ }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('KpiTile і ChangeChip', () => {
  it('чип зміни називає напрям словом, не лише кольором', () => {
    const { rerender } = render(<ChangeChip delta={2.5} />)
    expect(screen.getByText('Зросло')).toBeInTheDocument()
    rerender(<ChangeChip delta={-1} />)
    expect(screen.getByText('Знизилось')).toBeInTheDocument()
    rerender(<ChangeChip delta={0} />)
    expect(screen.getByText('Без змін')).toBeInTheDocument()
  })
})
