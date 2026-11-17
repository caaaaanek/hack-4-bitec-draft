import { render, screen } from '@testing-library/react'
import { Checkbox } from './Checkbox'
import { FormField } from './FormField'
import { Input } from './Input'
import { Radio } from './Radio'
import { Select } from './Select'
import { Textarea } from './Textarea'

describe('FormField', () => {
  it('зв’язує label з полем', () => {
    render(
      <FormField label="Назва">
        {({ id, describedBy, invalid }) => (
          <Input id={id} aria-describedby={describedBy} invalid={invalid} />
        )}
      </FormField>,
    )
    expect(screen.getByLabelText('Назва')).toBeInstanceOf(HTMLInputElement)
  })

  it('додає aria-describedby для підказки й помилки та aria-invalid', () => {
    render(
      <FormField label="Опис" hint="Кілька речень" error="Заповніть поле">
        {({ id, describedBy, invalid }) => (
          <Textarea id={id} aria-describedby={describedBy} invalid={invalid} />
        )}
      </FormField>,
    )
    const field = screen.getByLabelText('Опис')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    const ids = (field.getAttribute('aria-describedby') ?? '').split(' ')
    expect(ids).toHaveLength(2)
    const text = ids.map((i) => document.getElementById(i)?.textContent).join('|')
    expect(text).toContain('Кілька речень')
    expect(text).toContain('Заповніть поле')
  })

  it('без помилки не ставить aria-invalid', () => {
    render(
      <FormField label="Поле">
        {({ id, invalid }) => <Input id={id} invalid={invalid} />}
      </FormField>,
    )
    expect(screen.getByLabelText('Поле')).not.toHaveAttribute('aria-invalid')
  })
})

describe('контроли', () => {
  it('Input підтримує disabled', () => {
    render(<Input aria-label="x" disabled />)
    expect(screen.getByLabelText('x')).toBeDisabled()
  })

  it('Select рендерить опції й invalid', () => {
    render(
      <Select aria-label="Роль" invalid>
        <option value="a">Перша</option>
      </Select>,
    )
    expect(screen.getByLabelText('Роль')).toHaveAttribute('aria-invalid', 'true')
  })

  it('Checkbox і Radio мають підпис і підказку', () => {
    render(
      <>
        <Checkbox label="Погоджуюсь" hint="Можна змінити пізніше" />
        <Radio name="r" label="Варіант" disabled />
      </>,
    )
    const cb = screen.getByLabelText(/Погоджуюсь/)
    expect(cb).toHaveAccessibleDescription('Можна змінити пізніше')
    expect(screen.getByLabelText('Варіант')).toBeDisabled()
  })
})
