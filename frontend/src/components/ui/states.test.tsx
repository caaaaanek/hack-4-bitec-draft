import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ForbiddenState } from './ForbiddenState'
import { FlagNote } from './FlagNote'
import { LoadingState } from './LoadingState'
import { FORBIDDEN_TEXT, HIDDEN_GROUP_TEXT } from './messages'

describe('state components', () => {
  it('forbidden explains what is unavailable and links home, without alert role', () => {
    render(
      <MemoryRouter>
        <ForbiddenState />
      </MemoryRouter>,
    )
    expect(screen.getByText(FORBIDDEN_TEXT)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'На головну' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('flag note is phrased as further analysis, not a verdict', () => {
    const { container } = render(<FlagNote title="Розбіжність" />)
    expect(container).toHaveTextContent('Варто перевірити додатково')
    expect(container).toHaveTextContent('Напрям для додаткового аналізу')
  })
  it('loading state is announced as busy', () => {
    render(<LoadingState>x</LoadingState>)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Завантаження даних')).toBeInTheDocument()
  })
  it('hidden group text matches brief', () => {
    expect(HIDDEN_GROUP_TEXT).toBe(
      'Недостатньо відповідей, щоб показати результати цієї групи. Показано дані рівня вище. Це захищає анонімність учасників.',
    )
  })
})
