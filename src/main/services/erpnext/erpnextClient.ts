/**
 * ERPNext REST & RPC Client
 *
 * Communicates with Frappe/ERPNext instances over standard token-authenticated REST API.
 * Includes in-memory mock storage fallback when unconfigured or for offline evaluation.
 */

import type { ERPNextConfig, ERPNextDoc, ERPNextReportResult, QueryOptions } from './types'

export class ERPNextClient {
  private config: ERPNextConfig | null = null
  private mockStore = new Map<string, Map<string, ERPNextDoc>>()

  constructor(config?: ERPNextConfig) {
    if (config) {
      this.config = config
    }
    this.seedMockStore()
  }

  public setConfig(config: ERPNextConfig): void {
    this.config = config
  }

  public isConfigured(): boolean {
    return (
      Boolean(this.config?.baseUrl) &&
      Boolean(this.config?.apiKey) &&
      Boolean(this.config?.apiSecret)
    )
  }

  private seedMockStore(): void {
    // Seed sample customers
    const customers = new Map<string, ERPNextDoc>()
    customers.set('CUST-001', {
      name: 'CUST-001',
      doctype: 'Customer',
      customer_name: 'Acme Corporation',
      customer_type: 'Company',
      customer_group: 'Commercial',
      territory: 'United States',
      creation: new Date().toISOString()
    })
    customers.set('CUST-002', {
      name: 'CUST-002',
      doctype: 'Customer',
      customer_name: 'Apex Global Technologies',
      customer_type: 'Company',
      customer_group: 'Enterprise',
      territory: 'Global',
      creation: new Date().toISOString()
    })
    this.mockStore.set('Customer', customers)

    // Seed sample items / products
    const items = new Map<string, ERPNextDoc>()
    items.set('SKU-001', {
      name: 'SKU-001',
      doctype: 'Item',
      item_name: 'Enterprise Agent License',
      item_group: 'Software',
      stock_uom: 'Nos',
      standard_rate: 1200,
      is_stock_item: 0
    })
    items.set('SKU-002', {
      name: 'SKU-002',
      doctype: 'Item',
      item_name: 'Edge AI Compute Server',
      item_group: 'Hardware',
      stock_uom: 'Unit',
      standard_rate: 4500,
      is_stock_item: 1
    })
    this.mockStore.set('Item', items)

    // Seed sample sales invoice
    const invoices = new Map<string, ERPNextDoc>()
    invoices.set('ACC-SINV-2026-0001', {
      name: 'ACC-SINV-2026-0001',
      doctype: 'Sales Invoice',
      customer: 'CUST-001',
      posting_date: new Date().toISOString().slice(0, 10),
      grand_total: 4500,
      status: 'Unpaid',
      docstatus: 1, // Submitted
      items: [
        { item_code: 'SKU-002', qty: 1, rate: 4500, amount: 4500 }
      ]
    })
    this.mockStore.set('Sales Invoice', invoices)
  }

  private getAuthHeaders(): HeadersInit {
    if (!this.config) return {}
    return {
      Authorization: `token ${this.config.apiKey}:${this.config.apiSecret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
  }

  /**
   * Queries documents of a given DocType.
   */
  public async query(doctype: string, options: QueryOptions = {}): Promise<ERPNextDoc[]> {
    if (!this.isConfigured()) {
      const typeStore = this.mockStore.get(doctype)
      if (!typeStore) return []
      let docs = Array.from(typeStore.values())

      if (options.filters && Array.isArray(options.filters)) {
        for (const [key, op, val] of options.filters) {
          if (op === '=') {
            docs = docs.filter((d) => d[key] === val)
          } else if (op === '!=') {
            docs = docs.filter((d) => d[key] !== val)
          } else if (op === 'like') {
            docs = docs.filter((d) => String(d[key] || '').toLowerCase().includes(String(val).toLowerCase()))
          }
        }
      }

      if (options.limit && options.limit > 0) {
        docs = docs.slice(0, options.limit)
      }

      return docs
    }

    const url = new URL(`/api/resource/${encodeURIComponent(doctype)}`, this.config!.baseUrl)
    if (options.fields) {
      url.searchParams.set('fields', JSON.stringify(options.fields))
    }
    if (options.filters) {
      url.searchParams.set('filters', JSON.stringify(options.filters))
    }
    if (options.limit) {
      url.searchParams.set('limit_page_length', String(options.limit))
    }
    if (options.orderBy) {
      url.searchParams.set('order_by', options.orderBy)
    }

    const response = await fetch(url.toString(), {
      headers: this.getAuthHeaders(),
      signal: AbortSignal.timeout(15000)
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`ERPNext API Error (${response.status}): ${errorText}`)
    }

    const json = (await response.json()) as { data: ERPNextDoc[] }
    return json.data || []
  }

  /**
   * Fetches a single document by name.
   */
  public async getDoc(doctype: string, name: string): Promise<ERPNextDoc> {
    if (!this.isConfigured()) {
      const doc = this.mockStore.get(doctype)?.get(name)
      if (!doc) {
        throw new Error(`Document ${doctype} "${name}" not found.`)
      }
      return doc
    }

    const url = new URL(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, this.config!.baseUrl)
    const response = await fetch(url.toString(), {
      headers: this.getAuthHeaders(),
      signal: AbortSignal.timeout(15000)
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch ${doctype} "${name}": HTTP ${response.status}`)
    }

    const json = (await response.json()) as { data: ERPNextDoc }
    return json.data
  }

  /**
   * Creates a new document in ERPNext (starts in Draft, docstatus=0).
   */
  public async createDoc(doctype: string, data: Record<string, unknown>): Promise<ERPNextDoc> {
    if (!this.isConfigured()) {
      let typeStore = this.mockStore.get(doctype)
      if (!typeStore) {
        typeStore = new Map()
        this.mockStore.set(doctype, typeStore)
      }

      const generatedName = (data.name as string) || `${doctype.toUpperCase().replace(/\s+/g, '-')}-${Date.now()}`
      const newDoc: ERPNextDoc = {
        name: generatedName,
        doctype,
        docstatus: 0,
        creation: new Date().toISOString(),
        modified: new Date().toISOString(),
        ...data
      }

      typeStore.set(generatedName, newDoc)
      return newDoc
    }

    const url = new URL(`/api/resource/${encodeURIComponent(doctype)}`, this.config!.baseUrl)
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(15000)
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`ERPNext create ${doctype} failed (${response.status}): ${errorText}`)
    }

    const json = (await response.json()) as { data: ERPNextDoc }
    return json.data
  }

  /**
   * Updates an existing document.
   */
  public async updateDoc(doctype: string, name: string, patch: Record<string, unknown>): Promise<ERPNextDoc> {
    if (!this.isConfigured()) {
      const existing = await this.getDoc(doctype, name)
      const updated = {
        ...existing,
        ...patch,
        modified: new Date().toISOString()
      }
      this.mockStore.get(doctype)!.set(name, updated)
      return updated
    }

    const url = new URL(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, this.config!.baseUrl)
    const response = await fetch(url.toString(), {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(15000)
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`ERPNext update ${doctype} "${name}" failed (${response.status}): ${errorText}`)
    }

    const json = (await response.json()) as { data: ERPNextDoc }
    return json.data
  }

  /**
   * Submits a document (docstatus: 1), committing it permanently to ledgers.
   */
  public async submitDoc(doctype: string, name: string): Promise<ERPNextDoc> {
    return this.updateDoc(doctype, name, { docstatus: 1 })
  }

  /**
   * Runs pre-built financial or operational report.
   */
  public async runReport(reportName: string, filters: Record<string, unknown> = {}): Promise<ERPNextReportResult> {
    if (!this.isConfigured()) {
      return {
        columns: [
          { label: 'Account / Item', fieldname: 'item', fieldtype: 'Data', width: 200 },
          { label: 'Amount ($)', fieldname: 'amount', fieldtype: 'Currency', width: 120 },
          { label: 'Status', fieldname: 'status', fieldtype: 'Data', width: 100 }
        ],
        data: [
          { item: 'Accounts Receivable (Acme Corp)', amount: 4500, status: 'Unpaid' },
          { item: 'Operating Cash Reserve', amount: 125000, status: 'Active' },
          { item: 'Hardware Inventory Valuation', amount: 32000, status: 'Audited' }
        ],
        message: `Report "${reportName}" executed with simulated ledger snapshot.`
      }
    }

    const url = new URL('/api/method/frappe.desk.query_report.run', this.config!.baseUrl)
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        report_name: reportName,
        filters
      }),
      signal: AbortSignal.timeout(20000)
    })

    if (!response.ok) {
      throw new Error(`Failed to execute report "${reportName}": HTTP ${response.status}`)
    }

    const json = (await response.json()) as { message: ERPNextReportResult }
    return json.message
  }
}

export const erpnextClient = new ERPNextClient()
