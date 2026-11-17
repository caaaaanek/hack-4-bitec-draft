import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui'
import { resetDecisions } from '@/demo/decisionsStore'
import { Home } from './Home'

const setup = () =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </ToastProvider>,
  )

afterEach(() => resetDecisions())

describe('Дашборд за композицією еталона', () => {
  it('сім карток, по одному h2 на картку, без банера і ряду кнопок під заголовком', () => {
    const { container } = setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Огляд закладу' })).toBeInTheDocument()
    const cards = container.querySelectorAll('section[data-print="card"]')
    expect(cards.length).toBe(7)
    for (const c of cards) expect(c.querySelectorAll('h2')).toHaveLength(1)
    expect(screen.queryByText(/інструмент розвитку/)).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Швидкі переходи' })).toBeNull()
  })

  it('картка індексу: число, рівень, приріст, достовірність, причина, шкала й дата даних', () => {
    const { container } = setup()
    const card = screen.getByRole('region', { name: 'Індекс доброчесності' })
    expect(screen.getByTestId('summary')).toHaveTextContent(
      '54,2 бала, Визначений, достовірність C',
    )
    expect(within(card).getByText('Умовний військовий інститут «Альфа»')).toBeInTheDocument()
    expect(within(card).getByText('Зросло на 7,2 пункта')).toBeInTheDocument()
    expect(
      within(card).getByText('Підзвітність: самооцінку не підтверджують факти'),
    ).toBeInTheDocument()
    expect(within(card).getByText('Дані станом на 16.11.2026 · цикл 2026-11')).toBeInTheDocument()
    const scale = within(card).getByRole('list', { name: 'Шкала рівнів зрілості' })
    expect(within(scale).getAllByRole('listitem')).toHaveLength(5)
    expect(within(scale).getByText(/Початковий \(хаотичний\)/)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/—|підприємств|рейтинг/i)
  })

  it('«Участь»: категорії, «N з M», k = 10 і примітка для групи менше k', () => {
    setup()
    const card = screen.getByRole('region', { name: 'Участь' })
    expect(within(card).getByText('k = 10')).toBeInTheDocument()
    expect(within(card).getByText('Робоча група')).toBeInTheDocument()
    expect(within(card).getByText('Особовий склад')).toBeInTheDocument()
    expect(within(card).getByText('Експерти')).toBeInTheDocument()
    expect(within(card).getByRole('img', { name: 'Експерти: відповіли 4 з 6' })).toBeInTheDocument()
    expect(within(card).getAllByText(/Менше мінімальної групи/)).toHaveLength(1)
  })

  it('три компоненти ведуть на розклад, обмеження пояснено підказкою', async () => {
    setup()
    const acc = screen.getByRole('region', { name: 'Підзвітність' })
    expect(within(acc).getByRole('link', { name: /Підзвітність/ })).toHaveAttribute(
      'href',
      '/explain?c=accountability',
    )
    expect(within(acc).getByText('Потребує уваги')).toBeInTheDocument()
    await userEvent.hover(within(acc).getByText('Зараховано з обмеженням'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Сприйняття 80, факти 35, зараховано 60')
    expect(
      within(screen.getByRole('region', { name: 'Культура' })).getByText('+7,5'),
    ).toBeInTheDocument()
  })

  it('«Що потребує уваги»: напрями, сильні сторони, заходи й переходи', () => {
    setup()
    const card = screen.getByRole('region', { name: 'Що потребує уваги' })
    expect(within(card).getByText('Підтвердити факти')).toBeInTheDocument()
    expect(within(card).getByText('Сильні сторони')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /Заходи в трекері: 6/ })).toHaveAttribute(
      'href',
      '/tracker',
    )
    expect(within(card).getByText(/З них 1 прострочено/)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Рекомендації' })).toHaveAttribute(
      'href',
      '/recommendations',
    )
    expect(within(card).getByRole('link', { name: 'Звіт' })).toHaveAttribute('href', '/reports')
  })

  it('«Чому такий індекс» відкриває панель із фокусом, закривається Esc', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Чому такий індекс' }))
    const dialog = screen.getByRole('dialog', { name: 'Чому такий індекс' })
    expect(within(dialog).getByText('Показано з обмеженням')).toBeInTheDocument()
    expect(within(dialog).getByText('Як це рахується')).toBeInTheDocument()
    expect(within(dialog).getByText('Шкала рівнів зрілості')).toBeInTheDocument()
    expect(dialog.contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('пігулка достовірності відкриває панель на прапорцях', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /Достовірність C, прапорці: 2/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Варто перевірити додатково')).toBeInTheDocument()
    expect(
      within(dialog).getByText(/Розбіжність сприйняття й фактів у Підзвітності \(80 проти 35\)/),
    ).toBeInTheDocument()
  })

  it('динаміка: період, лінії компонентів і таблиця', async () => {
    setup()
    const card = screen.getByRole('region', { name: 'Динаміка індексу' })
    expect(within(card).getByRole('link', { name: 'Детальніше' })).toHaveAttribute(
      'href',
      '/trends',
    )
    const culture = within(card).getByRole('button', { name: /Культура/ })
    await userEvent.click(culture)
    expect(culture).toHaveAttribute('aria-pressed', 'true')
    await userEvent.selectOptions(within(card).getByLabelText('Початок періоду'), '2025-12')
    await userEvent.click(within(card).getByRole('button', { name: 'Показати як таблицю' }))
    const table = within(card).getByRole('table', { name: /Індекс і компоненти/ })
    expect(within(table).getByText('2025-12')).toBeInTheDocument()
    expect(within(table).queryByText('2025-06')).not.toBeInTheDocument()
  })
})
