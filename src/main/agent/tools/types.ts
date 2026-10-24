import { z } from 'zod'
import type { Artifact, BrowserState, Task } from '@shared/types'

export interface ToolContext {
  task: Task
  workspace: string
  roots: string[]
  allowShell: boolean
  /** Stable identities supplied by the agent runtime for durable delegation. */
  durableRunId?: string
  callId?: string
  addArtifact: (absPath: string, previewAbsPath?: string) => Promise<Artifact | null>
  setBrowser: (state: BrowserState) => void
  setPlan: (steps: string[]) => void
  toast: (level: 'info' | 'success' | 'error', message: string) => void
}

export type ToolRisk = 'low' | 'medium' | 'high'
export type ToolSideEffect = 'none' | 'read' | 'write' | 'execute' | 'network'

export interface ToolResult {
  content: string
  isError?: boolean
}

export interface AgentTool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  schema?: z.ZodTypeAny
  sideEffect: ToolSideEffect
  risk: ToolRisk
  approval: 'never' | 'policy' | 'always'
  execute: (args: any, ctx: ToolContext) => Promise<ToolResult>
  summarize?: (args: any) => string
}

interface DefineToolInput<S extends z.ZodTypeAny> {
  name: string
  title: string
  description: string
  schema: S
  sideEffect?: ToolSideEffect
  risk?: ToolRisk
  approval?: 'never' | 'policy' | 'always'
  execute: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolResult>
  summarize?: (args: z.infer<S>) => string
}

function defaultRisk(sideEffect: ToolSideEffect): ToolRisk {
  if (sideEffect === 'none' || sideEffect === 'read') return 'low'
  if (sideEffect === 'write' || sideEffect === 'network') return 'medium'
  return 'high'
}

export function defineTool<S extends z.ZodTypeAny>(input: DefineToolInput<S>): AgentTool {
  const sideEffect = input.sideEffect ?? 'read'
  const schema = z.toJSONSchema(input.schema, { unrepresentable: 'any' }) as Record<string, unknown>
  return {
    name: input.name,
    title: input.title,
    description: input.description,
    inputSchema: schema,
    schema: input.schema,
    sideEffect,
    risk: input.risk ?? defaultRisk(sideEffect),
    approval: input.approval ?? (sideEffect === 'read' || sideEffect === 'none' ? 'never' : 'policy'),
    execute: input.execute as AgentTool['execute'],
    summarize: input.summarize as AgentTool['summarize']
  }
}

export function toolResultError(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { content: `Error: ${message}`, isError: true }
}
