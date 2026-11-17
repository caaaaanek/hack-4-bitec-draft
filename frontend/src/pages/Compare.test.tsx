import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Compare } from './Compare'

const setup = () =>
  render(
    <MemoryRouter>
      <Compare />
    </MemoryRouter>,
  )

describe('Порівняння', () => {
  it('п’ять карток: профіль, сприйняття проти фактів, шкала, показники, достовірність', () => {
    const { container } = setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Порівняння' })).toBeInTheDocument()
    for (const n of [
      'Профіль',
      'Сприйняття vs факти',
      'Індекс на шкалі рівнів',
      'Об’єктивні показники',
      'Достовірність',
    ])
      expect(screen.getByRole('region', { name: n })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/—|підприємств|рейтинг/i)
  })

  it('профіль має таблицю-дубль і режим «Цикли»', async () => {
    setup()
    const card = screen.getByRole('region', { name: 'Профіль' })
    await userEvent.click(within(card).getByRole('button', { name: 'Показати як таблицю' }))
    expect(within(card).getByRole('table', { name: /значення компонентів/i })).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Показати як діаграму' }))
    await userEvent.click(within(card).getByRole('button', { name: 'Цикли' }))
    await userEvent.click(within(card).getByRole('button', { name: 'Показати як таблицю' }))
    expect(within(card).getByRole('columnheader', { name: 'Цикл 2026-06' })).toBeInTheDocument()
  })

  it('розрив: Підзвітність 45 і пояснення обмежувача, таблиця за джерелами', async () => {
    setup()
    const card = screen.getByRole('region', { name: 'Сприйняття vs факти' })
    expect(within(card).getByText(/Понад 25 пунктів спрацьовує обмежувач/)).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Показати як таблицю' }))
    const table = within(card).getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Експерти' })).toBeInTheDocument()
    expect(within(table).getByText('45')).toBeInTheDocument()
  })

  it('об’єктивні показники з кількостями й достовірність C з прапорцями', () => {
    setup()
    const obj = screen.getByRole('region', { name: 'Об’єктивні показники' })
    expect(within(obj).getByText('11 з 20')).toBeInTheDocument()
    const trust = screen.getByRole('region', { name: 'Достовірність' })
    expect(
      within(trust).getByText(/Розбіжність сприйняття й фактів у Підзвітності/),
    ).toBeInTheDocument()
  })
})
