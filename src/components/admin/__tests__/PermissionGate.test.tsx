// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PermissionGate } from '../PermissionGate'

afterEach(cleanup)

describe('PermissionGate', () => {
  it('passes allowed=true and no title when the permission is held', () => {
    render(
      <PermissionGate permissions={new Set(['manage_missions'])} permission="manage_missions">
        {(allowed, title) => <button disabled={!allowed} title={title}>Nouvelle mission</button>}
      </PermissionGate>,
    )
    const btn = screen.getByRole('button') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    expect(btn.getAttribute('title')).toBeNull()
  })

  it('passes allowed=true for a wildcard (admin/superadmin) permission set', () => {
    render(
      <PermissionGate permissions={new Set(['*'])} permission="manage_users">
        {(allowed) => <button disabled={!allowed}>Utilisateurs</button>}
      </PermissionGate>,
    )
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false)
  })

  it('passes allowed=false and a French tooltip naming the missing permission', () => {
    render(
      <PermissionGate permissions={new Set()} permission="manage_vehicles">
        {(allowed, title) => <button disabled={!allowed} title={title}>Véhicules</button>}
      </PermissionGate>,
    )
    const btn = screen.getByRole('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('title')).toContain('Gérer les véhicules')
  })

  it('falls back to the raw permission key when no French label is registered', () => {
    render(
      <PermissionGate permissions={new Set()} permission="some_future_permission">
        {(allowed, title) => <button disabled={!allowed} title={title}>X</button>}
      </PermissionGate>,
    )
    expect(screen.getByRole('button').getAttribute('title')).toContain('some_future_permission')
  })
})
