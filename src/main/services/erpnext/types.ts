/**
 * ERPNext Enterprise Bridge Types & Contracts
 */

export interface ERPNextConfig {
  baseUrl: string
  apiKey: string
  apiSecret: string
  defaultCompany?: string
}

export type DocStatus = 0 | 1 | 2 // 0: Draft, 1: Submitted, 2: Cancelled

export interface ERPNextDoc {
  name: string
  doctype: string
  docstatus?: DocStatus
  creation?: string
  modified?: string
  modified_by?: string
  owner?: string
  [key: string]: unknown
}

export type ERPNextFilter = [string, string, unknown]

export interface QueryOptions {
  filters?: ERPNextFilter[] | Record<string, unknown>
  fields?: string[]
  limit?: number
  orderBy?: string
}

export interface ERPNextReportResult {
  columns: Array<{ label: string; fieldname: string; fieldtype: string; width?: number }>
  data: Array<Record<string, unknown>>
  message?: string
}
