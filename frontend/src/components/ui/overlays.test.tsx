import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, getFocusable, nextFocusIndex } from './Dialog'
import { ConfirmDialog } from './ConfirmDialog'
import { Tooltip } from './Tooltip'
import { ToastProvider, useToast } from './Toast'

function Harness({ onCloseSpy }: { onCloseSpy?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Відкрити</button>
      <Dialog
        open={open}
        onClose={() => {
          onCloseSpy?.()
          setOpen(false)
        }}
        title="Заголовок"
        description="Опис"
        footer={<button>Дія</button>}
      >
        <input aria-label="Поле" />
      </Dialog>
    </>
  )
}

describe('nextFocusIndex', () => {
  it('cycles forward and backward', () => {
    expect(nextFocusIndex(0, 3, false)).toBe(1)
    expect(nextFocusIndex(2, 3, false)).toBe(0)
    expect(nextFocusIndex(0, 3, true)).toBe(2)
    expect(nextFocusIndex(2, 3, true)).toBe(1)
  })
  it('handles empty and unknown current', () => {
    expect(nextFocusIndex(0, 0, false)).toBe(-1)
    expect(nextFocusIndex(-1, 3, false)).toBe(0)
    expect(nextFocusIndex(-1, 3, true)).toBe(2)
  })
})

describe('getFocusable', () => {
  it('skips disabled and tabindex=-1', () => {
    const div = document.createElement('div')
    div.innerHTML =
      '<button>a</button><button disabled>b</button><span tabindex="-1">c</span><a href="#">d</a>'
    expect(getFocusable(div)).toHaveLength(2)
  })
})

describe('Dialog', () => {
  it('has aria attributes', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('Відкрити'))
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(dlg).toHaveAccessibleName('Заголовок')
    expect(dlg).toHaveAccessibleDescription('Опис')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('closes on Escape and restores focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByText('Відкрити')
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('closes on backdrop click', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    render(<Harness onCloseSpy={spy} />)
    await user.click(screen.getByText('Відкрити'))
    await user.click(screen.getByTestId('dialog-backdrop'))
    expect(spy).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('traps focus with Tab and Shift+Tab', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('Відкрити'))
    const close = screen.getByRole('button', { name: 'Закрити' })
    const last = screen.getByRole('button', { name: 'Дія' })
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(last).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
  })
})

describe('ConfirmDialog', () => {
  it('calls confirm and cancel', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog open title="Т" description="О" onConfirm={onConfirm} onCancel={onCancel} />,
    )
    await user.click(screen.getByRole('button', { name: 'Підтвердити' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Скасувати' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('Tooltip', () => {
  it('opens on focus and closes on Escape', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="Підказка">
        <span>Текст</span>
      </Tooltip>,
    )
    await user.tab()
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('Підказка')
    expect(screen.getByText('Текст').parentElement).toHaveAttribute('aria-describedby', tip.id)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('opens on click and toggles', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="Підказка">
        <span>Текст</span>
      </Tooltip>,
    )
    await user.click(screen.getByText('Текст'))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    await user.click(screen.getByText('Текст'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

describe('Toast', () => {
  function Pusher() {
    const { push } = useToast()
    return <button onClick={() => push({ title: 'Збережено', tone: 'success' })}>Показати</button>
  }

  it('renders live region and pushes toasts', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <Pusher />
      </ToastProvider>,
    )
    const region = screen.getByRole('region', { name: 'Сповіщення' })
    expect(region).toHaveAttribute('aria-live', 'polite')
    await user.click(screen.getByText('Показати'))
    expect(screen.getByRole('status')).toHaveTextContent('Збережено')
    await user.click(screen.getByRole('button', { name: 'Закрити сповіщення' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
