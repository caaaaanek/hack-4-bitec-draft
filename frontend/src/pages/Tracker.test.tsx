import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui'
import { DemoProvider } from '@/demo/DemoProvider'
import { getDecisions, resetDecisions } from '@/demo/decisionsStore'
import { Tracker } from './Tracker'

const setup = () =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <Tracker />
      </MemoryRouter>
    </ToastProvider>,
  )

afterEach(() => resetDecisions())

describe('Трекер', () => {
  it('шість заходів, один прострочений з текстом і іконкою', () => {
    const { container } = setup()
    expect(screen.getByText(/6 заходів, з них 1 прострочено/)).toBeInTheDocument()
    expect(screen.getAllByText('Прострочено на 11 днів').length).toBeGreaterThan(0)
    expect(container.textContent).not.toMatch(/—|підприємств|рейтинг/i)
  })

  it('верифікація: підтверджено і очікує підтвердження', () => {
    setup()
    expect(screen.getAllByText('Підтверджено наступним оцінюванням').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Очікує наступного оцінювання').length).toBeGreaterThan(0)
    const block = screen.getByRole('region', { name: 'Верифікація наступним оцінюванням' })
    expect(within(block).getByText(/Підтверджено: 1/)).toBeInTheDocument()
    expect(within(block).getByText(/Очікують наступного оцінювання: 1/)).toBeInTheDocument()
  })

  it('фільтр за статусом і посадою', async () => {
    setup()
    await userEvent.selectOptions(screen.getByLabelText('Статус'), 'overdue')
    expect(screen.getByText('Показано 1 з 6')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Статус'), 'all')
    await userEvent.selectOptions(screen.getByLabelText('Відповідальна посада'), 'Начальник штабу')
    expect(screen.getByText('Показано 1 з 6')).toBeInTheDocument()
  })

  it('перемикач «Таблиця / Дошка»', async () => {
    setup()
    expect(screen.getByRole('button', { name: 'Таблиця' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Дошка' }))
    expect(screen.getByRole('region', { name: 'Колонка «В роботі»' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Колонка «Підтверджено»' })).toBeInTheDocument()
  })

  it('керівник змінює статус вручну, зміна зберігається', async () => {
    setup()
    const select = screen.getAllByLabelText(
      /Змінити статус заходу «Призначити відповідальну особу/,
    )[0]!
    await userEvent.selectOptions(select, 'inprogress')
    expect(getDecisions().measureStatus['m-6']).toBe('inprogress')
    expect(screen.getAllByText(/Статус заходу змінено на «В роботі»/).length).toBeGreaterThan(0)
  })

  it('аудитор бачить лише читання, без елементів зміни статусу', () => {
    sessionStorage.setItem('demo.role', 'auditor')
    render(
      <ToastProvider>
        <MemoryRouter>
          <DemoProvider>
            <Tracker />
          </DemoProvider>
        </MemoryRouter>
      </ToastProvider>,
    )
    expect(screen.getByText(/Режим читання/)).toBeInTheDocument()
    expect(screen.queryAllByLabelText(/Змінити статус заходу/)).toHaveLength(0)
    sessionStorage.clear()
  })
})
