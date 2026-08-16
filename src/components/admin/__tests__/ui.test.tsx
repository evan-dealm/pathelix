// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { Input } from '../ui'

// A thin controlled wrapper matching every real call site in the app: onChange re-derives a
// number from the string and feeds it straight back into `value` as a formatted string, e.g.
// `onChange={v => setForm(f => ({ ...f, latitude: parseFloat(v) || 0 }))}` then
// `value={String(form.latitude)}`.
function NumericField({ onChange }: { onChange?: (_v: string) => void }) {
  const [latitude, setLatitude] = useState(0)
  return (
    <Input type="number" value={String(latitude)} onChange={v => {
      const n = parseFloat(v) || 0
      setLatitude(n)
      onChange?.(v)
    }} />
  )
}

describe('Input (type=number)', () => {
  // Regression: found via manual QA typing a GPS latitude into the site creation form.
  // Native <input type="number"> reports an empty string to onChange while the raw text is a
  // transient invalid float (typing the "." in "45.8992" is invalid until a digit follows it).
  // Every real caller does `parseFloat(v) || 0`, so that empty tick set state to 0 and the next
  // render forced the DOM value back to "0" — permanently erasing the "45" already typed. Typing
  // "45.8992" character by character ended up storing 8992 as the latitude, silently.
  it('does not erase digits typed before a decimal point', () => {
    render(<NumericField />)
    const input = screen.getByDisplayValue('0') as HTMLInputElement

    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.change(input, { target: { value: '45.' } })
    fireEvent.change(input, { target: { value: '45.8' } })
    fireEvent.change(input, { target: { value: '45.89' } })

    expect(input.value).toBe('45.89')
  })

  it('accepts a comma as decimal separator (French keyboard) and reports it with a dot', () => {
    const onChange = vi.fn()
    render(<NumericField onChange={onChange} />)
    const input = screen.getByDisplayValue('0') as HTMLInputElement

    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.change(input, { target: { value: '45,8' } })

    expect(input.value).toBe('45,8')
    expect(onChange).toHaveBeenLastCalledWith('45.8')
  })

  it('renders as a real number input for whole-number fields with no visible regression', () => {
    render(<NumericField />)
    const input = screen.getByDisplayValue('0') as HTMLInputElement
    fireEvent.change(input, { target: { value: '42' } })
    expect(input.value).toBe('42')
  })

  it('rejects non-numeric characters', () => {
    render(<NumericField />)
    const input = screen.getByDisplayValue('0') as HTMLInputElement
    fireEvent.change(input, { target: { value: '4a5' } })
    expect(input.value).toBe('0')
  })
})
