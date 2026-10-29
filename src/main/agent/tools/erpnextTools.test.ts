import { describe, it, expect } from 'vitest'
import {
  erpnextTools,
  erpnextQueryTool,
  erpnextGetDocTool,
  erpnextCreateDocTool,
  erpnextUpdateDocTool,
  erpnextSubmitDocTool,
  erpnextRunReportTool
} from './erpnextTools'
import type { ToolContext } from './types'

const dummyCtx = {} as ToolContext

describe('ERPNext Native Agent Tools', () => {
  it('exposes all 6 ERPNext enterprise tools with valid schemas and ToolResult contracts', () => {
    expect(erpnextTools.length).toBe(6)
    for (const tool of erpnextTools) {
      expect(tool.name).toBeDefined()
      expect(tool.title).toBeDefined()
      expect(tool.description).toBeDefined()
      expect(tool.inputSchema).toBeDefined()
      expect(tool.sideEffect).toBeDefined()
      expect(tool.risk).toBeDefined()
      expect(tool.approval).toBeDefined()
    }
  })

  it('queries documents via erpnext_query', async () => {
    const res = (await erpnextQueryTool.execute(
      { doctype: 'Customer', limit: 10 },
      dummyCtx
    )) as any
    expect(res.status).toBe('success')
    expect(typeof res.content).toBe('string')
    expect(res.doctype).toBe('Customer')
    expect(res.count).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(res.records)).toBe(true)
  })

  it('retrieves a document by name via erpnext_get_doc', async () => {
    const res = (await erpnextGetDocTool.execute(
      { doctype: 'Customer', name: 'CUST-001' },
      dummyCtx
    )) as any
    expect(res.status).toBe('success')
    expect(typeof res.content).toBe('string')
    expect(res.document).toBeDefined()
    expect(res.document.name).toBe('CUST-001')
  })

  it('creates and retrieves a document via erpnext_create_doc', async () => {
    const res = (await erpnextCreateDocTool.execute(
      {
        doctype: 'Customer',
        data: {
          customer_name: 'Stark Industries',
          customer_group: 'Commercial',
          territory: 'United States'
        }
      },
      dummyCtx
    )) as any
    expect(res.status).toBe('created')
    expect(typeof res.content).toBe('string')
    expect(res.document).toBeDefined()
    expect(res.document.customer_name).toBe('Stark Industries')

    // Query it back
    const getRes = (await erpnextGetDocTool.execute(
      { doctype: 'Customer', name: res.document.name },
      dummyCtx
    )) as any
    expect(getRes.status).toBe('success')
    expect(getRes.document.customer_name).toBe('Stark Industries')
  })

  it('updates a document via erpnext_update_doc', async () => {
    const res = (await erpnextUpdateDocTool.execute(
      {
        doctype: 'Customer',
        name: 'CUST-001',
        patch: { territory: 'Europe' }
      },
      dummyCtx
    )) as any
    expect(res.status).toBe('updated')
    expect(typeof res.content).toBe('string')
    expect(res.document.territory).toBe('Europe')
  })

  it('submits a submittable document via erpnext_submit_doc', async () => {
    // First create a Sales Invoice draft
    const createRes = (await erpnextCreateDocTool.execute(
      {
        doctype: 'Sales Invoice',
        data: {
          customer: 'CUST-001',
          grand_total: 1500,
          currency: 'USD',
          status: 'Draft'
        }
      },
      dummyCtx
    )) as any
    expect(createRes.status).toBe('created')
    const invoiceName = createRes.name

    // Submit it
    const submitRes = (await erpnextSubmitDocTool.execute(
      { doctype: 'Sales Invoice', name: invoiceName },
      dummyCtx
    )) as any
    expect(submitRes.status).toBe('submitted')
    expect(typeof submitRes.content).toBe('string')
    expect(submitRes.docstatus).toBe(1)
  })

  it('runs an ERPNext report via erpnext_run_report', async () => {
    const res = (await erpnextRunReportTool.execute(
      { reportName: 'General Ledger', filters: { company: 'SelfImpulse Inc' } },
      dummyCtx
    )) as any
    expect(res.status).toBe('success')
    expect(typeof res.content).toBe('string')
    expect(res.reportName).toBe('General Ledger')
    expect(Array.isArray(res.columns)).toBe(true)
    expect(Array.isArray(res.data)).toBe(true)
  })
})
