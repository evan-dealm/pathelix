// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import { Tooltip, JargonTip } from '@/components/ui/Tooltip'

afterEach(cleanup)

describe('Tooltip', () => {
  it('renders children without tooltip initially', () => {
    render(<Tooltip content="Aide"><span>Label</span></Tooltip>)
    expect(screen.getByText('Label')).toBeTruthy()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows tooltip after mouseEnter (200ms delay)', async () => {
    vi.useFakeTimers()
    render(<Tooltip content="Texte aide"><span>Hover me</span></Tooltip>)
    const wrapper = screen.getByText('Hover me').parentElement!
    fireEvent.mouseEnter(wrapper)
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByRole('tooltip')).toBeTruthy()
    expect(screen.getByRole('tooltip').textContent).toBe('Texte aide')
    vi.useRealTimers()
  })

  it('hides tooltip on mouseLeave', async () => {
    vi.useFakeTimers()
    render(<Tooltip content="Aide"><span>Hover me</span></Tooltip>)
    const wrapper = screen.getByText('Hover me').parentElement!
    fireEvent.mouseEnter(wrapper)
    act(() => { vi.advanceTimersByTime(200) })
    fireEvent.mouseLeave(wrapper)
    expect(screen.queryByRole('tooltip')).toBeNull()
    vi.useRealTimers()
  })

  it('shows tooltip on focus (keyboard accessible)', () => {
    vi.useFakeTimers()
    render(<Tooltip content="Focus help"><span>Item</span></Tooltip>)
    const wrapper = screen.getByText('Item').parentElement!
    fireEvent.focus(wrapper)
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByRole('tooltip')).toBeTruthy()
    vi.useRealTimers()
  })

  it('hides tooltip on blur', () => {
    vi.useFakeTimers()
    render(<Tooltip content="Focus help"><span>Item</span></Tooltip>)
    const wrapper = screen.getByText('Item').parentElement!
    fireEvent.focus(wrapper)
    act(() => { vi.advanceTimersByTime(200) })
    fireEvent.blur(wrapper)
    expect(screen.queryByRole('tooltip')).toBeNull()
    vi.useRealTimers()
  })

  it('cancels timer on quick mouseLeave before 200ms', () => {
    vi.useFakeTimers()
    render(<Tooltip content="Aide"><span>Fast</span></Tooltip>)
    const wrapper = screen.getByText('Fast').parentElement!
    fireEvent.mouseEnter(wrapper)
    act(() => { vi.advanceTimersByTime(100) })
    fireEvent.mouseLeave(wrapper)
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    vi.useRealTimers()
  })

  // Regression N6: show() scheduled setVisible(true) via a 200ms setTimeout with no cleanup on
  // unmount — a component unmounted while the timer is pending (e.g. hovered element removed
  // from the DOM right after mouseenter) would still fire and call setVisible on an unmounted
  // component.
  it('clears the pending show timer on unmount', () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { unmount } = render(<Tooltip content="Aide"><span>Unmount me</span></Tooltip>)
    const wrapper = screen.getByText('Unmount me').parentElement!
    fireEvent.mouseEnter(wrapper)
    unmount()
    expect(clearTimeoutSpy).toHaveBeenCalled()
    // Advancing timers past the delay must not throw or touch unmounted state.
    expect(() => act(() => { vi.advanceTimersByTime(200) })).not.toThrow()
    clearTimeoutSpy.mockRestore()
    vi.useRealTimers()
  })
})

describe('JargonTip', () => {
  it('renders help icon for known term', () => {
    render(<JargonTip term="exutoire" />)
    expect(screen.getByText('?')).toBeTruthy()
  })

  it('renders nothing for unknown term', () => {
    const { container } = render(<JargonTip term={'unknown_term' as 'exutoire'} />)
    expect(container.firstChild).toBeNull()
  })

  it('has aria-label for accessibility', () => {
    render(<JargonTip term="valhallaFactor" />)
    const icon = screen.getByLabelText('Aide : valhallaFactor')
    expect(icon).toBeTruthy()
  })

  it('shows jargon definition in tooltip on hover', async () => {
    vi.useFakeTimers()
    render(<JargonTip term="exutoire" />)
    const icon = screen.getByLabelText('Aide : exutoire')
    fireEvent.mouseEnter(icon.parentElement!)
    act(() => { vi.advanceTimersByTime(200) })
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toContain('dépôt')
    vi.useRealTimers()
  })
})
