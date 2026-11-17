import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { DemoProvider } from '@/demo/DemoProvider'
import { AppShell } from '@/components/layout/AppShell'
import { ToastProvider } from '@/components/ui'
import { Home } from './Home'
import { Institutions } from './Institutions'
import { Integrations } from './Integrations'

const setup = (path = '/institutions') => {
  sessionStorage.setItem('demo.role', 'observer')
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <DemoProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/institutions" element={<Institutions />} />
              <Route path="/integrations" element={<Integrations />} />
              <Route path="/" element={<Home />} />
            </Route>
          </Routes>
        </DemoProvider>
      </MemoryRouter>
    </ToastProvider>,
  )
}

beforeEach(() => sessionStorage.clear())

describe('Заклади для спостерігача', () => {
  it('картки в алфавітному порядку, без сортування за індексом і номерів позицій', () => {
    const { container } = setup()
    const names = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent!.replace(': відкрити огляд закладу', ''))
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'uk')))
    expect(names).toHaveLength(4)
    expect(
      screen.getByText('Показано узагальнені дані. Заклади не порівнюються між собою.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /сортув|за індексом/i })).toBeNull()
    expect(container.textContent).not.toMatch(/—|рейтинг|місце|ліга/i)
    expect(container.querySelector('ol')).toBeNull()
  })

  it('на картці індекс, рівень, достовірність і зміна текстом', () => {
    setup()
    const card = screen.getByRole('link', { name: /Альфа/ }).closest('li')!
    expect(within(card).getByText('54,2')).toBeInTheDocument()
    expect(within(card).getByText('Зросло на 7,2 пункта')).toBeInTheDocument()
    expect(within(card).getByText('Потрібна перевірка')).toBeInTheDocument()
  })

  it('клік відкриває огляд закладу з хлібними крихтами', async () => {
    setup()
    await userEvent.click(screen.getByRole('link', { name: /Бета/ }))
    expect(screen.getByRole('heading', { name: 'Огляд закладу' })).toBeInTheDocument()
    const crumbs = screen.getByRole('navigation', { name: 'Хлібні крихти' })
    expect(within(crumbs).getByRole('link', { name: 'Усі заклади' })).toBeInTheDocument()
    expect(within(crumbs).getByText(/Бета/)).toBeInTheDocument()
  })

  it('«Звідки беруться дані»: сім метрик і чесні режими', () => {
    setup('/integrations')
    expect(screen.getByRole('heading', { name: 'Карта інтеграцій' })).toBeInTheDocument()
    expect(screen.getAllByText('Планується').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Потребує погодження').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Результати анкет').length).toBeGreaterThan(0)
  })
})
