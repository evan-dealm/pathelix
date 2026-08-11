// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { OnboardingGuide, resetOnboarding } from '@/components/ui/OnboardingGuide'

const LS_KEY = 'pathelix-onboarding-v1'

beforeEach(() => {
  localStorage.clear()
})

afterEach(cleanup)

describe('OnboardingGuide — visibility', () => {
  it('shows when localStorage key absent (first visit)', () => {
    render(<OnboardingGuide />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('hidden when localStorage key present (already seen)', () => {
    localStorage.setItem(LS_KEY, '1')
    render(<OnboardingGuide />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('forceShow overrides localStorage flag', () => {
    localStorage.setItem(LS_KEY, '1')
    render(<OnboardingGuide forceShow />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('OnboardingGuide — navigation', () => {
  it('shows step 1 content on mount', () => {
    render(<OnboardingGuide />)
    expect(screen.getByText('Planifiez vos tournées')).toBeTruthy()
  })

  it('advances to next step on "Suivant"', () => {
    render(<OnboardingGuide />)
    fireEvent.click(screen.getByRole('button', { name: 'Étape suivante' }))
    expect(screen.getByText('Gérez votre flotte')).toBeTruthy()
  })

  it('goes back to previous step on "Précédent"', () => {
    render(<OnboardingGuide />)
    fireEvent.click(screen.getByRole('button', { name: 'Étape suivante' }))
    fireEvent.click(screen.getByRole('button', { name: 'Étape précédente' }))
    expect(screen.getByText('Planifiez vos tournées')).toBeTruthy()
  })

  it('shows "Commencer" on last step', () => {
    render(<OnboardingGuide />)
    // Click through all steps
    const nextBtn = screen.getByRole('button', { name: 'Étape suivante' })
    fireEvent.click(nextBtn)
    fireEvent.click(screen.getByRole('button', { name: 'Étape suivante' }))
    fireEvent.click(screen.getByRole('button', { name: 'Étape suivante' }))
    expect(screen.getByRole('button', { name: 'Terminer le guide' })).toBeTruthy()
  })

  it('dismisses on "Commencer" (last step)', () => {
    render(<OnboardingGuide />)
    fireEvent.click(screen.getByRole('button', { name: 'Étape suivante' }))
    fireEvent.click(screen.getByRole('button', { name: 'Étape suivante' }))
    fireEvent.click(screen.getByRole('button', { name: 'Étape suivante' }))
    fireEvent.click(screen.getByRole('button', { name: 'Terminer le guide' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('dismisses on "Passer" click', () => {
    render(<OnboardingGuide />)
    fireEvent.click(screen.getByRole('button', { name: 'Passer le guide' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('persists dismissal to localStorage', () => {
    render(<OnboardingGuide />)
    fireEvent.click(screen.getByRole('button', { name: 'Passer le guide' }))
    expect(localStorage.getItem(LS_KEY)).toBe('1')
  })

  it('calls onClose when dismissed', () => {
    const onClose = vi.fn()
    render(<OnboardingGuide onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Passer le guide' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('OnboardingGuide — driver mode', () => {
  it('shows driver-specific first step', () => {
    render(<OnboardingGuide mode="driver" />)
    expect(screen.getByText('Votre plan du jour')).toBeTruthy()
  })
})

describe('resetOnboarding', () => {
  it('removes the localStorage key', () => {
    localStorage.setItem(LS_KEY, '1')
    resetOnboarding()
    expect(localStorage.getItem(LS_KEY)).toBeNull()
  })
})
