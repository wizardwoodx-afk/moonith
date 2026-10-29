/**
 * ERPNext Native Agent Tools
 *
 * Equips both Self and Cowork modes with full Enterprise Resource Planning
 * capabilities: Accounting, Invoicing, Inventory, CRM, and Project tracking.
 */

import { z } from 'zod'
import { erpnextClient } from '../../services/erpnext'
import type { AgentTool, ToolContext, ToolResult } from './types'

export const erpnextQueryTool: AgentTool = {
  name: 'erpnext_query',
  title: 'ERPNext Query Documents',
  description:
    'Query records from ERPNext for any DocType (e.g. "Customer", "Sales Invoice", "Item", "Purchase Order", "Employee", "Task") with filters and projection fields.',
  sideEffect: 'read',
  risk: 'low',
  approval: 'never',
  inputSchema: {
    type: 'object',
    properties: {
      doctype: { type: 'string', description: 'The DocType to query (e.g. "Customer", "Sales Invoice", "Item")' },
      filters: { type: 'array', description: 'Optional filter triples, e.g. [["status", "=", "Unpaid"]]' },
      fields: { type: 'array', items: { type: 'string' }, description: 'Fields to select' },
      limit: { type: 'number', description: 'Max records to fetch (default 20)' }
    },
    required: ['doctype']
  },
  schema: z.object({
    doctype: z.string().min(1),
    filters: z.array(z.tuple([z.string(), z.string(), z.any()])).optional(),
    fields: z.array(z.string()).optional(),
    limit: z.number().min(1).max(100).optional()
  }),
  execute: async (args: any, _ctx?: ToolContext): Promise<ToolResult & Record<string, unknown>> => {
    try {
      const doctype = String(args.doctype)
      const docs = await erpnextClient.query(doctype, {
        filters: args.filters,
        fields: args.fields,
        limit: args.limit || 20
      })

      const data = {
        status: 'success',
        doctype,
        count: docs.length,
        records: docs
      }

      return {
        content: JSON.stringify(data, null, 2),
        ...data
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return {
        content: `Error querying ERPNext: ${msg}`,
        isError: true,
        status: 'error'
      }
    }
  }
}

export const erpnextGetDocTool: AgentTool = {
  name: 'erpnext_get_doc',
  title: 'ERPNext Get Document',
  description: 'Retrieve a complete ERPNext document with its child tables and metadata by name/ID.',
  sideEffect: 'read',
  risk: 'low',
  approval: 'never',
  inputSchema: {
    type: 'object',
    properties: {
      doctype: { type: 'string', description: 'DocType (e.g. "Sales Invoice")' },
      name: { type: 'string', description: 'Document name/ID (e.g. "ACC-SINV-2026-0001")' }
    },
    required: ['doctype', 'name']
  },
  schema: z.object({
    doctype: z.string().min(1),
    name: z.string().min(1)
  }),
  execute: async (args: any, _ctx?: ToolContext): Promise<ToolResult & Record<string, unknown>> => {
    try {
      const doc = await erpnextClient.getDoc(String(args.doctype), String(args.name))
      const data = {
        status: 'success',
        doctype: args.doctype,
        name: args.name,
        document: doc
      }
      return {
        content: JSON.stringify(data, null, 2),
        ...data
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return {
        content: `Error fetching document: ${msg}`,
        isError: true,
        status: 'error'
      }
    }
  }
}

export const erpnextCreateDocTool: AgentTool = {
  name: 'erpnext_create_doc',
  title: 'ERPNext Create Document',
  description:
    'Create a new ERPNext document (e.g. Sales Invoice, Customer, Lead, Task, Purchase Order). Creates in Draft mode.',
  sideEffect: 'write',
  risk: 'medium',
  approval: 'policy',
  inputSchema: {
    type: 'object',
    properties: {
      doctype: { type: 'string', description: 'Target DocType to create' },
      data: { type: 'object', description: 'Record fields and line items' }
    },
    required: ['doctype', 'data']
  },
  schema: z.object({
    doctype: z.string().min(1),
    data: z.record(z.string(), z.unknown())
  }),
  execute: async (args: any, _ctx?: ToolContext): Promise<ToolResult & Record<string, unknown>> => {
    try {
      const doc = await erpnextClient.createDoc(String(args.doctype), args.data as Record<string, unknown>)
      const data = {
        status: 'created',
        doctype: doc.doctype,
        name: doc.name,
        docstatus: doc.docstatus,
        document: doc
      }
      return {
        content: JSON.stringify(data, null, 2),
        ...data
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return {
        content: `Error creating ${args.doctype}: ${msg}`,
        isError: true,
        status: 'error'
      }
    }
  }
}

export const erpnextUpdateDocTool: AgentTool = {
  name: 'erpnext_update_doc',
  title: 'ERPNext Update Document',
  description: 'Update fields of an existing ERPNext record.',
  sideEffect: 'write',
  risk: 'medium',
  approval: 'policy',
  inputSchema: {
    type: 'object',
    properties: {
      doctype: { type: 'string', description: 'DocType' },
      name: { type: 'string', description: 'Document name/ID' },
      patch: { type: 'object', description: 'Fields to update' }
    },
    required: ['doctype', 'name', 'patch']
  },
  schema: z.object({
    doctype: z.string().min(1),
    name: z.string().min(1),
    patch: z.record(z.string(), z.unknown())
  }),
  execute: async (args: any, _ctx?: ToolContext): Promise<ToolResult & Record<string, unknown>> => {
    try {
      const doc = await erpnextClient.updateDoc(
        String(args.doctype),
        String(args.name),
        args.patch as Record<string, unknown>
      )
      const data = {
        status: 'updated',
        doctype: doc.doctype,
        name: doc.name,
        document: doc
      }
      return {
        content: JSON.stringify(data, null, 2),
        ...data
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return {
        content: `Error updating document: ${msg}`,
        isError: true,
        status: 'error'
      }
    }
  }
}

export const erpnextSubmitDocTool: AgentTool = {
  name: 'erpnext_submit_doc',
  title: 'ERPNext Submit Document (Commit to Ledger)',
  description:
    'Permanently commits a Draft document to the general ledger or stock registry (docstatus: 1). Requires human approval in Cowork mode.',
  sideEffect: 'write',
  risk: 'high',
  approval: 'always',
  inputSchema: {
    type: 'object',
    properties: {
      doctype: { type: 'string', description: 'DocType to submit' },
      name: { type: 'string', description: 'Document name/ID' }
    },
    required: ['doctype', 'name']
  },
  schema: z.object({
    doctype: z.string().min(1),
    name: z.string().min(1)
  }),
  execute: async (args: any, _ctx?: ToolContext): Promise<ToolResult & Record<string, unknown>> => {
    try {
      const doc = await erpnextClient.submitDoc(String(args.doctype), String(args.name))
      const data = {
        status: 'submitted',
        doctype: doc.doctype,
        name: doc.name,
        docstatus: 1,
        message: `Document ${doc.doctype} "${doc.name}" has been permanently committed to ERPNext ledgers.`
      }
      return {
        content: JSON.stringify(data, null, 2),
        ...data
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return {
        content: `Error submitting document: ${msg}`,
        isError: true,
        status: 'error'
      }
    }
  }
}

export const erpnextRunReportTool: AgentTool = {
  name: 'erpnext_run_report',
  title: 'ERPNext Run Financial/Operations Report',
  description:
    'Run standard analytical and financial reports (e.g. "General Ledger", "Accounts Receivable", "Stock Balance", "Profit and Loss").',
  sideEffect: 'read',
  risk: 'low',
  approval: 'never',
  inputSchema: {
    type: 'object',
    properties: {
      reportName: { type: 'string', description: 'Report name (e.g. "Accounts Receivable", "General Ledger")' },
      filters: { type: 'object', description: 'Optional report filters' }
    },
    required: ['reportName']
  },
  schema: z.object({
    reportName: z.string().min(1),
    filters: z.record(z.string(), z.unknown()).optional()
  }),
  execute: async (args: any, _ctx?: ToolContext): Promise<ToolResult & Record<string, unknown>> => {
    try {
      const result = await erpnextClient.runReport(
        String(args.reportName),
        (args.filters as Record<string, unknown>) || {}
      )
      const data = {
        status: 'success',
        reportName: args.reportName,
        columns: result.columns,
        rowCount: result.data.length,
        data: result.data,
        summary: result.message
      }
      return {
        content: JSON.stringify(data, null, 2),
        ...data
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return {
        content: `Error running report: ${msg}`,
        isError: true,
        status: 'error'
      }
    }
  }
}

export const erpnextTools: AgentTool[] = [
  erpnextQueryTool,
  erpnextGetDocTool,
  erpnextCreateDocTool,
  erpnextUpdateDocTool,
  erpnextSubmitDocTool,
  erpnextRunReportTool
]
