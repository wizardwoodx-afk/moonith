import { z } from 'zod'
import type { ApprovalReview, Artifact, BrowserState, Task } from '@shared/types'

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
  harness?: any
  callId?: string
  /** Assistant turn the current call belongs to; files it writes are shown there. */
  messageId?: string
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
  /** Show the always-allow option only for tools whose approval is repeatable. */
  allowAlways?: boolean
  /** What the user should read before approving. Told the parsed arguments and
   *  the tool context, so a file write can be shown as its real diff. */
  approvalReview?: (args: any, ctx: ToolContext) => ApprovalReview | undefined | Promise<ApprovalReview | undefined>
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
  approvalReview?: (
    args: z.infer<S>,
    ctx: ToolContext
  ) => ApprovalReview | undefined | Promise<ApprovalReview | undefined>
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

/** Plan mode keeps the agent on the read side of the machine. Research,
 *  browsing and its own plan tool stay; anything that changes a file, runs a
 *  command, or carries a standing-approval contract does not reach the model. */
export function isAllowedInPlanMode(tool: AgentTool): boolean {
  /* Must agree with the plan-mode rule in nomos/policy.ts: this decides what
   * the model is even shown, and a network action that changes a live page or
   * an outside system is not a read. */
  const readOnly =
    tool.sideEffect === 'none' ||
    tool.sideEffect === 'read' ||
    (tool.sideEffect === 'network' && tool.risk === 'low')
  return readOnly && tool.approval !== 'always'
}

export function toolResultError(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { content: `Error: ${message}`, isError: true }
}