import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { DemoProvider } from '@/demo/DemoProvider'
import { getMyResults } from '@/demo/me'
import { unitResponses } from '@/demo/units'
import { HIDDEN_GROUP_TEXT } from '@/components/ui'
import { Me } from './Me'

const setup = (unit: string) => {
  sessionStorage.setItem('demo.role', 'respondent')
  sessionStorage.setItem('demo.unit', unit)
  return render(
    <MemoryRouter>
      <DemoProvider>
        <Me />
      </DemoProvider>
    </MemoryRouter>,
  )
}

describe('логіка k на екрані учасника', () => {
  it('рівно 10 показується, 9 ховається', () => {
    expect(getMyResults('unit-a', { ...unitResponses, 'unit-a': 10 }).resolved.hidden).toBe(false)
    expect(getMyResults('unit-a', { ...unitResponses, 'unit-a': 9 }).resolved.hidden).toBe(true)
  })
})

describe('Me', () => {
  beforeEach(() => sessionStorage.clear())
  it('Підрозділ А (12): результати, минулий цикл, далі, таблиця й текстовий опис', () => {
    const { container } = setup('unit-a')
    expect(screen.queryByText(HIDDEN_GROUP_TEXT)).toBeNull()
    expect(screen.getByText('Дякуємо, ось що ви допомогли побачити.')).toBeInTheDocument()
    expect(screen.getAllByRole('meter')).toHaveLength(3)
    expect(screen.getByText('Що зроблено з минулого циклу')).toBeInTheDocument()
    expect(screen.getByText('Що буде далі')).toBeInTheDocument()
    expect(screen.getByText('Показати як таблицю')).toBeInTheDocument()
    expect(container.textContent).toMatch(/Текстом: Культура/)
    expect(container.textContent).not.toMatch(/—|підприємств|рейтинг/i)
  })
  it('Підрозділ Б (3): прихована група й дані батьківського підрозділу', () => {
    setup('unit-b')
    expect(screen.getByText(HIDDEN_GROUP_TEXT)).toBeInTheDocument()
    expect(
      screen.getByText(/Показано дані рівня вище: Умовний військовий інститут «Альфа»/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Це рівень вище, а не ваш підрозділ/)).toBeInTheDocument()
    expect(screen.getAllByRole('meter')).toHaveLength(3)
  })
})
