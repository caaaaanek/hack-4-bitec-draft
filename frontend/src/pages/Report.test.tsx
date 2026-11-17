import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Report } from './Report'

describe('Звіт', () => {
  it('аркуш із індексом, компонентами, напрямами й прапорцями, без заборонених слів', () => {
    const { container } = render(
      <MemoryRouter>
        <Report />
      </MemoryRouter>,
    )
    const sheet = screen.getByRole('article')
    expect(
      within(sheet).getByText(/Умовний військовий інститут «Альфа» · цикл 2026-11/),
    ).toBeInTheDocument()
    expect(within(sheet).getByText('54,2')).toBeInTheDocument()
    expect(within(sheet).getByText('60 (з обмеженням)')).toBeInTheDocument()
    expect(within(sheet).getByText('Що потребує уваги')).toBeInTheDocument()
    expect(within(sheet).getByText('Варто перевірити додатково')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/—|підприємств|рейтинг/i)
  })

  it('кнопка «Друкувати» викликає друк', async () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    render(
      <MemoryRouter>
        <Report />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Друкувати' }))
    expect(print).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
