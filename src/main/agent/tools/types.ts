import { z } from 'zod'
import type { ApprovalReview, Artifact, BrowserState, Task } from '@shared/types'
import { redactSensitiveText } from '../../selfimpulse/governance/dlp'

export interface ToolContext {
  task: Task
  workspace: string
  /** Write/execute roots. Crew contexts receive only their private workspace and granted folders. */
  roots: string[]
  /** Optional broader read-only roots, including the Captain's shared task workspace. */
  readRoots?: string[]
  /** Distinct Chromium storage/session key for Captain or one Crew run. */
  browserScope?: string
  browserLabel?: string
  actor?: 'captain' | 'crew'
  allowShell: boolean
  /** Stable identities supplied by the agent runtime for durable delegation. */
  durableRunId?: string
  callId?: string
  addArtifact: (absPath: string, previewAbsPath?: string) => Promise<Artifact | null>
  setBrowser: (state: BrowserState) => void
  setPlan: (steps: string[]) => void
  toast: (level: 'info' | 'success' | 'error', message: string) => void
}

export function readRootsFor(ctx: ToolContext): string[] {
  return ctx.readRoots ?? ctx.roots
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
  /** Optional rich, human-reviewable draft carried by the existing approval broker. */
  approvalReview?: (args: any) => ApprovalReview | undefined
  /** Drafts that change on every call can disable the per-task always-allow shortcut. */
  allowAlways?: boolean
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
  approvalReview?: (args: z.infer<S>) => ApprovalReview | undefined
  allowAlways?: boolean
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
    approvalReview: input.approvalReview as AgentTool['approvalReview'],
    allowAlways: input.allowAlways,
    execute: input.execute as AgentTool['execute'],
    summarize: input.summarize as AgentTool['summarize']
  }
}

export function toolResultError(error: unknown): ToolResult {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : 'The tool operation failed.'
  const redacted = redactSensitiveText(raw, ['secret', 'api-key']).text
  const message = redacted
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 6000)
  return { content: `Error: ${message}`, isError: true }
}
