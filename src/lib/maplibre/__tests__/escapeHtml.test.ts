import { describe, it, expect } from 'vitest'
import { escapeHtml } from '@/lib/maplibre/escapeHtml'

describe('escapeHtml', () => {
  it('escapes a script tag (stored XSS via a mission/client name)', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes an img onerror payload', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('escapes ampersands, quotes and apostrophes', () => {
    expect(escapeHtml(`Tom & Jerry's "Depot"`)).toBe('Tom &amp; Jerry&#39;s &quot;Depot&quot;')
  })

  it('leaves plain text untouched', () => {
    expect(escapeHtml('Carrefour Divonne')).toBe('Carrefour Divonne')
  })

  it('escapes a realistic malicious client name breaking out of an attribute', () => {
    const clientName = `Client" onmouseover="alert('pwned')`
    const escaped = escapeHtml(clientName)
    expect(escaped).not.toContain('"')
    expect(escaped).not.toContain("'")
    expect(escaped).toBe('Client&quot; onmouseover=&quot;alert(&#39;pwned&#39;)')
  })

  it('escapes & before other entities are introduced (no double-escaping)', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })
})
