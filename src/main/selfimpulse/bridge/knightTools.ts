/**
 * KNIGHT'S TOOL PACK, handed to the SelfImpulse engine.
 *
 * The engine shipped ten tools of its own (calculator, clock, search,
 * web_search, memory_*, preference_save, workspace_*, system_info). Knight
 * ships the working half of a desktop agent: real files, real documents, a
 * real browser, real shell, real web fetch, durable memory.
 *
 * This module is the seam. It does not reimplement any of them — it adapts
 * Knight's `AgentTool` contract to the engine's `SelfImpulseTool` contract and
 * registers the result in `SELFIMPULSE_TOOLS`, so the engine's own governed
 * execution throat (schema check → guardrail → human gate → capability →
 * receipt) still decides every call.
 *
 * Two tools are deliberately NOT registered:
 *   • `web_search` — the engine's own version is offline-capable (Wikipedia,
 *     Hacker News, GitHub) with live providers as an upgrade; replacing it
 *     would be a downgrade for a machine with no search key.
 *   • `update_plan` — the engine already owns planning per turn. A second plan
 *     surface that the engine does not read would be a claim, not a state.
 */
import type { Task } from '@shared/types'
import { getBuiltinTools } from '../../agent/tools'
import type { AgentTool, ToolContext } from '../../agent/tools/types'
import { registerTool } from '../selfimpulse/engine/selfimpulse'

/** The engine's home on disk; created by the facade before tools register. */
export const SELFIMPULSE_TASK_ID = 'selfimpulse'

const SKIPPED = new Set(['web_search', 'update_plan'])

/**
 * The engine has no task row, so it gets a stable pseudo-task. Only `id` and
 * `folders` are read by the tools: `id` keys the browser session, `folders`
 * gives workspace-scoped memory somewhere to belong.
 */
export function knightToolContext(workspace: string, allowShell: boolean): ToolContext {
  const task = {
    id: SELFIMPULSE_TASK_ID,
    title: 'SelfImpulse',
    mode: 'cowork',
    status: 'running',
    workspace,
    folders: [workspace],
    attachments: [],
    messages: [],
    plan: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as unknown as Task

  return {
    task,
    workspace,
    roots: [workspace],
    allowShell,
    /* The file is real and its path is in the tool's own output. There is no
     * task artifact list to attach it to, so the receipt says null rather than
     * minting an artifact row that no surface can open. */
    addArtifact: async () => null,
    setBrowser: () => {},
    setPlan: () => {},
    toast: () => {}
  }
}

/** A compact argument hint for the engine's prompt — names and required keys. */
function argHint(tool: AgentTool): string {
  const schema = tool.inputSchema as {
    properties?: Record<string, unknown>
    required?: string[]
  }
  const names = Object.keys(schema?.properties ?? {})
  if (names.length === 0) return ''
  const required = new Set(schema?.required ?? [])
  return ` Arguments: ${names.map((n) => (required.has(n) ? `${n} (required)` : n)).join(', ')}.`
}

function describeFailure(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues
    return issues
      .map((issue) => `${issue.path.filter((p): p is string => typeof p === 'string').join('.') || '<args>'}: ${issue.message}`)
      .join('; ')
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * Register Knight's tools under the engine's contract. Returns the names that
 * were added so the facade can state, in words, what the engine can now do.
 */
export function registerKnightTools(ctx: ToolContext): string[] {
  const added: string[] = []

  for (const tool of getBuiltinTools('cowork')) {
    if (SKIPPED.has(tool.name)) continue

    registerTool(tool.name, {
      name: tool.name,
      description: `${tool.title} — ${tool.description}${argHint(tool)}`,
      /* Knight already encodes the human gate: `approval: 'policy'` means the
       * side effect needs a decision. The engine's gate then pauses on exactly
       * the tools Knight would have paused on. */
      risky: tool.approval === 'policy',
      run: async (args) => {
        try {
          const parsed = tool.schema ? tool.schema.safeParse(args) : null
          if (parsed && !parsed.success) {
            return { output: `arguments refused: ${describeFailure(parsed.error)}`, ok: false }
          }
          const result = await tool.execute(parsed ? parsed.data : args, ctx)
          return { output: result.content, ok: !result.isError }
        } catch (error) {
          return { output: `the tool failed: ${describeFailure(error)}`, ok: false }
        }
      }
    })
    added.push(tool.name)
  }

  return added
}
