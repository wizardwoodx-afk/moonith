import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { load } from 'cheerio'
import { describe, expect, it } from 'vitest'
import type { RuntimeAuditIntegrity } from '@shared/audit'
import { AuditHealth } from './AuditHealth'

const healthy: RuntimeAuditIntegrity = {
  ok: true,
  entries: 2,
  head: 'a'.repeat(64)
}

function render(integrity: RuntimeAuditIntegrity) {
  return load(renderToStaticMarkup(createElement(AuditHealth, { integrity })))
}

describe('AuditHealth', () => {
  it('warns about missing events after recording fails even when the chain verifies', () => {
    const $ = render({
      ...healthy,
      lastRecordError: 'Disk full',
      lastRecordFailedAt: '2026-10-29T10:20:30.000Z'
    })

    expect($.text()).toContain('verified: 2 runtime entries')
    const warning = $('[role="alert"]')
    expect(warning.text()).toMatch(/recording failed/i)
    expect(warning.text()).toMatch(/some events may be missing/i)
    expect(warning.text()).toContain('Disk full')
    expect(warning.find('time').attr('datetime')).toBe('2026-10-29T10:20:30.000Z')
    expect(warning.find('time').text().trim()).not.toBe('')
  })

  it.each([undefined, null, ''])('does not warn in a clean recording state (%s)', (lastRecordError) => {
    const $ = render({ ...healthy, lastRecordError })

    expect($('[role="alert"]').length).toBe(0)
    expect($.text()).not.toMatch(/recording failed|some events may be missing/i)
    expect($.text()).toContain('verified: 2 runtime entries')
    expect($.text()).toContain(`Signed head ${healthy.head}`)
  })

  it.each([undefined, 'Disk full'])('retains invalid-chain status independently of recording errors (%s)', (lastRecordError) => {
    const $ = render({ ...healthy, ok: false, reason: 'Signature mismatch', lastRecordError })

    expect($.text()).toMatch(/integrity needs attention/i)
    expect($.text()).toContain('Signature mismatch')
    expect($.text()).not.toContain('verified:')
    expect($('[role="alert"]').length).toBe(lastRecordError ? 1 : 0)
  })

  it('renders error details as text and omits an absent failure timestamp', () => {
    const $ = render({ ...healthy, lastRecordError: '<img src=x onerror="alert(1)">' })
    const warning = $('[role="alert"]')

    expect(warning.text()).toContain('<img src=x onerror="alert(1)">')
    expect(warning.find('img, script').length).toBe(0)
    expect(warning.find('time').length).toBe(0)
  })

  it('states the limited verification scope and independent evidence preservation', () => {
    const $ = render(healthy)

    expect($.text()).toMatch(/active ledger segment/i)
    expect($.text()).toMatch(/preserve exported evidence independently/i)
  })
})
