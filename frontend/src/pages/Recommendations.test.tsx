import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui'
import { getDecisions, resetDecisions } from '@/demo/decisionsStore'
import { Recommendations } from './Recommendations'

const setup = () =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <Recommendations />
      </MemoryRouter>
    </ToastProvider>,
  )

afterEach(() => resetDecisions())

const card = (name: RegExp | string) => screen.getByRole('article', { name })

describe('Рекомендації', () => {
  it('п’ять карток, підпис про рішення керівника, посилання «На підставі»', () => {
    const { container } = setup()
    expect(screen.getAllByRole('article')).toHaveLength(5)
    expect(
      screen.getByText('Рекомендація це пропозиція системи, рішення приймає керівник.'),
    ).toBeInTheDocument()
    const c = card(/конфліктів інтересів/)
    expect(within(c).getByText('Чому система це пропонує')).toBeInTheDocument()
    expect(within(c).getByText('На підставі')).toBeInTheDocument()
    const links = within(c).getAllByRole('link', { name: /Відкрити в розкладі/ })
    expect(links[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/explain\?c=accountability&n=/),
    )
    expect(container.textContent).not.toMatch(/—|підприємств|рейтинг|підозр/i)
  })

  it('фільтри за статусом і компонентом', async () => {
    setup()
    await userEvent.selectOptions(screen.getByLabelText('Компонент'), 'culture')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    await userEvent.selectOptions(screen.getByLabelText('Статус'), 'accepted')
    expect(screen.getByText('За цими фільтрами рекомендацій немає')).toBeInTheDocument()
  })

  it('«Прийняти» відкриває діалог, створює захід і оголошує результат', async () => {
    setup()
    const c = card(/конфліктів інтересів/)
    await userEvent.click(within(c).getByRole('button', { name: 'Прийняти' }))
    const dialog = screen.getByRole('dialog', { name: 'Прийняти рекомендацію' })
    await userEvent.selectOptions(
      within(dialog).getByLabelText(/Відповідальна посада/),
      'Начальник штабу',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Прийняти й створити захід' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(getDecisions().added).toHaveLength(1)
    expect(getDecisions().added[0]).toMatchObject({
      responsiblePosition: 'Начальник штабу',
      status: 'accepted',
    })
    expect(within(card(/конфліктів інтересів/)).getByText('Прийнято')).toBeInTheDocument()
    expect(screen.getAllByText(/додано до трекера/).length).toBeGreaterThan(0)
    expect(screen.getByTestId('announce')).toHaveTextContent('додано до трекера')
  })

  it('«Відхилити» вимагає причину, помилка під полем', async () => {
    setup()
    const c = card(/закупівлі/)
    await userEvent.click(within(c).getByRole('button', { name: 'Відхилити' }))
    const dialog = screen.getByRole('dialog', { name: 'Відхилити рекомендацію' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Відхилити' }))
    expect(within(dialog).getByText('Вкажіть причину відхилення.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Причина відхилення/)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await userEvent.type(within(dialog).getByLabelText(/Причина відхилення/), 'Уже розглядається')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Відхилити' }))
    expect(within(card(/закупівлі/)).getByText('Відхилено')).toBeInTheDocument()
    expect(screen.getByText(/Причина відхилення: Уже розглядається/)).toBeInTheDocument()
  })

  it('«Уточнити» ставить статус «Уточнено» і дозволяє потім прийняти', async () => {
    setup()
    const c = card(/процедури/)
    await userEvent.click(within(c).getByRole('button', { name: 'Уточнити' }))
    const dialog = screen.getByRole('dialog', { name: 'Уточнити рекомендацію' })
    await userEvent.type(within(dialog).getByLabelText(/Короткий коментар/), 'Потрібні приклади')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Надіслати уточнення' }))
    const after = card(/процедури/)
    expect(within(after).getByText('Уточнено')).toBeInTheDocument()
    expect(within(after).getByRole('button', { name: 'Прийняти' })).toBeInTheDocument()
    expect(within(after).queryByRole('button', { name: 'Уточнити' })).not.toBeInTheDocument()
  })
})
