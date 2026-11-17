import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { DemoProvider } from '@/demo/DemoProvider'
import { useDemo } from '@/demo/demoContext'
import { ForbiddenState, FORBIDDEN_TEXT } from '@/components/ui'
import { AppShell } from './AppShell'

function Probe() {
  const { scope, role } = useDemo()
  const { pathname } = useLocation()
  return <output data-testid="probe">{`${role}|${scope}|${pathname}`}</output>
}

const setup = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <DemoProvider>
        <Probe />
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<p>Огляд-вміст</p>} />
            <Route path="/me" element={<p>Мої-вміст</p>} />
            <Route path="/manage" element={<p>Керування-вміст</p>} />
          </Route>
        </Routes>
      </DemoProvider>
    </MemoryRouter>,
  )

describe('AppShell і демо-панель', () => {
  beforeEach(() => sessionStorage.clear())

  it('керівник бачить огляд; недоступний маршрут дає ForbiddenState, не картку помилки', () => {
    setup('/')
    expect(screen.getByText('Огляд-вміст')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('прямий перехід на недоступний маршрут показує ForbiddenState з кнопкою на головний екран', () => {
    setup('/manage')
    expect(screen.getByRole('note')).toHaveTextContent(FORBIDDEN_TEXT)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Керування-вміст')).toBeNull()
    expect(screen.getByRole('link', { name: 'На головну' })).toHaveAttribute('href', '/')
  })

  it('зміна ролі веде на маршрут за замовчуванням, скидає scope, закриває панель, зберігає роль', async () => {
    const user = userEvent.setup()
    setup('/')
    await user.click(screen.getByRole('button', { name: /^Демо/ }))
    await user.click(screen.getByRole('radio', { name: 'Респондент' }))
    expect(screen.getByTestId('probe')).toHaveTextContent('respondent|unit-a|/me')
    expect(screen.queryByRole('region', { name: 'Демо-панель' })).toBeNull()
    expect(sessionStorage.getItem('demo.role')).toBe('respondent')
    // навігація лише доступна: у респондента немає «Огляд»
    expect(screen.queryByRole('link', { name: 'Огляд' })).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Мої результати' }).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /^Демо/ }))
    await user.click(screen.getByRole('radio', { name: /^Підрозділ Б/ }))
    expect(screen.getByTestId('probe')).toHaveTextContent('respondent|unit-b|/me')
    await user.click(screen.getByRole('radio', { name: 'Керівник закладу' }))
    expect(screen.getByTestId('probe')).toHaveTextContent('leader|alpha|/')
  })

  it('«Скинути демо-дані» повертає роль за замовчуванням', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem('demo.role', 'admin')
    setup('/manage')
    expect(screen.getByText('Керування-вміст')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Демо/ }))
    await user.click(screen.getByRole('button', { name: 'Скинути демо-дані' }))
    expect(screen.getByTestId('probe')).toHaveTextContent('leader|alpha|/')
  })

  it('пошук ⌘K: палітра показує лише доступні сторінки, Enter переходить', async () => {
    const user = userEvent.setup()
    setup('/')
    await user.keyboard('{Control>}k{/Control}')
    const box = screen.getByPlaceholderText('Назва сторінки')
    expect(box).toHaveFocus()
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('Огляд')
    expect(options).not.toContain('Керування циклом')
    await user.type(box, 'ог')
    await user.keyboard('{Enter}')
    expect(screen.queryByPlaceholderText('Назва сторінки')).toBeNull()
    expect(screen.getByTestId('probe')).toHaveTextContent('/')
    // відкриття кнопкою в бічній панелі
    await user.click(screen.getAllByRole('button', { name: 'Пошук по сторінках' })[0]!)
    expect(screen.getByPlaceholderText('Назва сторінки')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Назва сторінки'), 'ъъъ')
    expect(screen.getByText('Нічого не знайдено')).toBeInTheDocument()
  })

  it('верхня панель без дзвінка й довідки, є вибір ролі в картці «Роль»', () => {
    setup('/')
    expect(screen.queryByRole('button', { name: 'Сповіщення' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Довідка/ })).toBeNull()
    expect(screen.getAllByRole('combobox', { name: 'Роль для демо' }).length).toBeGreaterThan(0)
  })

  it('ForbiddenState окремо: текст і посилання', () => {
    render(
      <MemoryRouter>
        <ForbiddenState homeHref="/me" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'На головну' })).toHaveAttribute('href', '/me')
  })
})

describe('перемикач теми', () => {
  it('перемикає тему з aria-label і запамʼятовує вибір', async () => {
    const user = userEvent.setup()
    document.documentElement.removeAttribute('data-theme')
    setup('/')
    await user.click(screen.getByRole('button', { name: 'Увімкнути темну тему' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('iap-theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Увімкнути світлу тему' })).toBeInTheDocument()
  })
})
