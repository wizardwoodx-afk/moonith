export type MarketspaceSource = 'builtin' | 'local'
export type MarketspaceTrust = 'reviewed' | 'local'

export interface MarketspaceEntry {
  id: string
  kind: 'design-system'
  name: string
  description: string
  version: string
  source: MarketspaceSource
  trust: MarketspaceTrust
  installed: boolean
  updatedAt: string
  /** Deliberately declarative: native entries cannot install executables. */
  capabilities: Array<'prompt:inject' | 'artifact:write'>
}

export interface MarketspaceSnapshot {
  entries: MarketspaceEntry[]
  total: number
}

export interface MarketspaceDetail extends MarketspaceEntry {
  design: string
  preview: string
  files: string[]
}

export interface MarketspaceCreateInput {
  name: string
  description: string
  design: string
}

export interface MarketspaceApplyResult {
  id: string
  directory: string
  files: string[]
  overwritten: boolean
}
