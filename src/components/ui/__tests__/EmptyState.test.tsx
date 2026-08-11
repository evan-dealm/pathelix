// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { EmptyState } from '@/components/ui/EmptyState'

afterEach(cleanup)

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="Aucune mission" />)
    expect(screen.getByText('Aucune mission')).toBeTruthy()
  })

  it('renders description when provided', () => {
    render(<EmptyState title="Aucune mission" description="Créez une mission pour commencer." />)
    expect(screen.getByText('Créez une mission pour commencer.')).toBeTruthy()
  })

  it('does not render description element when omitted', () => {
    render(<EmptyState title="Aucune mission" />)
    expect(screen.queryByRole('paragraph')).toBeNull()
  })

  it('renders icon slot', () => {
    render(<EmptyState title="Aucune mission" icon={<span data-testid="icon">🚛</span>} />)
    expect(screen.getByTestId('icon')).toBeTruthy()
  })

  it('renders action button with label', () => {
    render(<EmptyState title="Vide" action={{ label: 'Créer', onClick: vi.fn() }} />)
    expect(screen.getByRole('button', { name: 'Créer' })).toBeTruthy()
  })

  it('calls action.onClick when button clicked', () => {
    const onClick = vi.fn()
    render(<EmptyState title="Vide" action={{ label: 'Créer', onClick }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not render button when action is omitted', () => {
    render(<EmptyState title="Vide" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('has accessible role=status', () => {
    render(<EmptyState title="Vide" />)
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('applies custom className', () => {
    const { container } = render(<EmptyState title="Vide" className="custom-class" />)
    expect((container.firstChild as HTMLElement).className).toContain('custom-class')
  })
})
