import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { DemoProvider } from '@/demo/DemoProvider'
import { DEMO_SURVEY } from '@/demo/survey'
import { DRAFT_PREFIX, answeredCount, loadDraft, missingQuestions } from '@/lib/survey'
import { Survey } from './Survey'

const setup = (token: string) =>
  render(
    <MemoryRouter initialEntries={[`/s/${token}`]}>
      <DemoProvider>
        <Routes>
          <Route path="/s/:token" element={<Survey />} />
          <Route path="/me" element={<p>Екран учасника</p>} />
        </Routes>
      </DemoProvider>
    </MemoryRouter>,
  )

const allQuestions = DEMO_SURVEY.sections.flatMap((s) => s.questions)

describe('логіка анкети', () => {
  beforeEach(() => localStorage.clear())
  it('структура: 3 розділи по 3 питання, по 5 варіантів з рівнями 1-5', () => {
    expect(DEMO_SURVEY.sections).toHaveLength(3)
    for (const s of DEMO_SURVEY.sections) expect(s.questions).toHaveLength(3)
    for (const qq of allQuestions) expect(qq.options.map((o) => o.level)).toEqual([1, 2, 3, 4, 5])
  })
  it('повнота: перелічує пропущені з розділом і номером', () => {
    const m = missingQuestions(DEMO_SURVEY, { 'cu-1': 'cu-1-o3' })
    expect(m).toHaveLength(8)
    expect(m[0]!.label).toBe('Розділ «Культура», питання 2')
    expect(
      missingQuestions(
        DEMO_SURVEY,
        Object.fromEntries(allQuestions.map((q) => [q.id, q.options[0]!.id])),
      ),
    ).toEqual([])
  })
  it('чернетка ігнорує сторонні дані', () => {
    localStorage.setItem(
      DRAFT_PREFIX + 'demo',
      JSON.stringify({ 'cu-1': 'cu-1-o2', 'cu-2': 'x', name: 'Іван' }),
    )
    expect(loadDraft(DEMO_SURVEY, 'demo')).toEqual({ 'cu-1': 'cu-1-o2' })
    expect(answeredCount(DEMO_SURVEY, loadDraft(DEMO_SURVEY, 'demo'))).toBe(1)
  })
})

describe('екран опитування', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('використаний жетон: зрозумілий стан, не помилка', () => {
    setup('used')
    expect(screen.getByText('Цю анкету вже заповнено')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('недійсний жетон: пояснення і крок', () => {
    setup('bad')
    expect(screen.getByText('Посилання недійсне або застаріле')).toBeInTheDocument()
    expect(screen.getByText(/попросіть нове посилання/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('гарантії, кроки, автозбереження, повнота й подяка', async () => {
    const user = userEvent.setup()
    const { unmount } = setup('demo')
    expect(screen.getByText(/не повʼязані з вами і не містять імен/)).toBeInTheDocument()
    expect(screen.getByText(/не менше 10 осіб/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Розумію, почати' }))
    expect(screen.getByText('Розділ 1 з 3')).toBeInTheDocument()

    // відповідь зберігається
    const first = within(
      screen.getByRole('group', { name: /1\. Як у вашому підрозділі/ }),
    ).getAllByRole('radio')
    await user.click(first[2]!)
    expect(JSON.parse(localStorage.getItem(DRAFT_PREFIX + 'demo')!)).toEqual({ 'cu-1': 'cu-1-o3' })

    // відновлення після перезавантаження
    unmount()
    setup('demo')
    await user.click(screen.getByRole('button', { name: 'Розумію, почати' }))
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1)

    // неповна відправка: перелік пропущених
    await user.click(screen.getByRole('button', { name: 'Далі' }))
    expect(screen.getByText('Розділ 2 з 3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Далі' }))
    await user.click(screen.getByRole('button', { name: 'Надіслати' }))
    expect(screen.getByText(/Залишилось відповісти на 8/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Розділ «Культура», питання 2' })).toBeInTheDocument()

    // перехід за якорем у інший розділ
    await user.click(screen.getByRole('link', { name: 'Розділ «Система», питання 1' }))
    expect(screen.getByText('Розділ 2 з 3')).toBeInTheDocument()
  })

  it('липка верхня смуга, лічильник розділу, закриття з підтвердженням', async () => {
    const user = userEvent.setup()
    setup('demo')
    await user.click(screen.getByRole('button', { name: 'Розумію, почати' }))
    expect(screen.getByText('Анонімне опитування')).toBeInTheDocument()
    expect(
      screen.getByText('Культура: 3 питання про ставлення до доброчесності'),
    ).toBeInTheDocument()
    expect(screen.getByText('Відповіли на 0 з 3')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Розділ 1 з 3')
    const first = within(
      screen.getByRole('group', { name: /1\. Як у вашому підрозділі/ }),
    ).getAllByRole('radio')
    await user.click(first[1]!)
    expect(screen.getByText('Відповіли на 1 з 3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Закрити' }))
    expect(screen.getByRole('dialog', { name: 'Закрити опитування?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Продовжити заповнення' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('закриття без відповідей не питає підтвердження', async () => {
    const user = userEvent.setup()
    localStorage.clear()
    setup('demo')
    await user.click(screen.getByRole('button', { name: 'Розумію, почати' }))
    await user.click(screen.getByRole('button', { name: 'Закрити' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('повна анкета веде до подяки без імен і часу, чернетку очищено', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      DRAFT_PREFIX + 'demo',
      JSON.stringify(Object.fromEntries(allQuestions.map((q) => [q.id, q.options[3]!.id]))),
    )
    setup('demo')
    await user.click(screen.getByRole('button', { name: 'Розумію, почати' }))
    await user.click(screen.getByRole('button', { name: 'Далі' }))
    await user.click(screen.getByRole('button', { name: 'Далі' }))
    await user.click(screen.getByRole('button', { name: 'Надіслати' }))
    expect(screen.getByText('Дякуємо. Ваші відповіді збережено анонімно.')).toBeInTheDocument()
    expect(localStorage.getItem(DRAFT_PREFIX + 'demo')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Переглянути результати підрозділу' }))
    expect(screen.getByText('Екран учасника')).toBeInTheDocument()
  })
})
