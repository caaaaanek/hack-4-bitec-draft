import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui'
import { Explain } from './Explain'

const setup = (url = '/explain') =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[url]}>
        <Explain />
      </MemoryRouter>
    </ToastProvider>,
  )

describe('Розклад індексу', () => {
  it('показує перевірку суми і дерево', () => {
    const { container } = setup()
    expect(screen.getByTestId('sum-check')).toHaveTextContent('Сума внесків = Індекс 54,2')
    expect(screen.getByRole('tree')).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(3)
    expect(container.textContent).not.toMatch(/—|підприємств|рейтинг/i)
  })
  it('компонент з адреси розкрито, обмежувач позначено', () => {
    setup('/explain?c=accountability')
    expect(screen.getByText('Прозорість рішень керівництва')).toBeInTheDocument()
    expect(screen.getAllByText('Обмежувач').length).toBeGreaterThan(0)
  })
  it('керується клавіатурою', async () => {
    setup('/explain?c=culture')
    const items = () => screen.getAllByRole('treeitem')
    items()[0]!.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(items()[1]).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(items()[1]).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard('{ArrowRight}')
    expect(items()[1]).toHaveAttribute('aria-expanded', 'true')
  })
  it('перемикає режими й таблицю', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Сприйняття' }))
    expect(screen.getByTestId('sum-check')).toHaveTextContent('60,8')
    await userEvent.click(screen.getByRole('button', { name: 'Показати як таблицю' }))
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
