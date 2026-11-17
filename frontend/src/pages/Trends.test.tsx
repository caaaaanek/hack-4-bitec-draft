import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Trends } from './Trends'

const setup = () =>
  render(
    <MemoryRouter>
      <Trends />
    </MemoryRouter>,
  )

describe('Динаміка', () => {
  it('має великий графік, порівняння й висновок без заборонених слів', () => {
    const { container } = setup()
    expect(screen.getByRole('heading', { name: 'Динаміка' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Динаміка індексу' })).toBeInTheDocument()
    expect(screen.getByText(/Позитивна динаміка: Культура/)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/—|підприємств|рейтинг/i)
  })

  it('порівняння двох циклів: показник, було, стало, зміна словами', async () => {
    setup()
    const table = screen.getByRole('table', { name: /Порівняння циклів 2025-06 і 2026-11/ })
    expect(within(table).getAllByText('Зросло на 19,5 пункта')[0]).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Було (цикл)'), '2026-11')
    await userEvent.selectOptions(screen.getByLabelText('Стало (цикл)'), '2025-06')
    expect(screen.getAllByText('Знизилось на 19,5 пункта')[0]).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Стало (цикл)'), '2026-11')
    expect(screen.getByText(/Оберіть два різні цикли/)).toBeInTheDocument()
  })
})
