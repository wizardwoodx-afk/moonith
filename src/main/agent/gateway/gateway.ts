/**
 * Tool Execution Gateway for SelfImpulse.
 *
 * Coordinates:
 * 1. Authorization + Parameter Validation
 * 2. OpenAI Guardrails Safety Checks
 * 3. Human Approval where required
 * 4. Idempotency & Resource-Version Verification
 * 5. Persistent Action Journaling
 */
import { guardrails } from '../guardrails'
import { idempotencyStore } from './idempotency'
import { resourceVersionGuard, type ResourceVersionCheck } from './versionLock'
import { actionJournal, ActionJournal } from './actionJournal'
import { passportManager } from '../../sphragis/passport'
import { capabilityForTool } from '../../nomos/policy'
import { quarantineService } from '../../selfimpulse/trust/quarantine'
import { costAccounting } from '../../selfimpulse/operations/costAccounting'
import { untrustedOutputSanitizer } from '../../selfimpulse/trust/untrustedOutput'
import { flightRecorder } from '../../selfimpulse/trust/flightRecorder'
import type { ActionIds } from '../../nomos'
import type { GovernedAction } from '@shared/enterprise'

export interface GatewayExecutionRequest {
  ids: ActionIds
  tool: {
    name: string
    sideEffect: GovernedAction['sideEffect']
    risk: GovernedAction['risk']
    approval: GovernedAction['approval']
  }
  args: Record<string, unknown>
  idempotencyKey?: string
  versionCheck?: ResourceVersionCheck
  execute: () => Promise<{ content: string; isError?: boolean }>
}

export interface GatewayExecutionResult {
  content: string
  isError: boolean
  cached?: boolean
  journalEntryId: string
}

export class ToolExecutionGateway {
  async execute(req: GatewayExecutionRequest): Promise<GatewayExecutionResult> {
    const started = Date.now()
    const idempotencyKey = req.idempotencyKey ?? idempotencyStore.generateKey(req.ids.agentId, req.tool.name, req.args)

    // -1. Quarantine & System Kill Switch Verification
    const quarantineCheck = quarantineService.canExecute(req.ids.agentId)
    if (!quarantineCheck.allowed) {
      return {
        content: `Error: Execution halted by Quarantine/Kill Switch: ${quarantineCheck.reason}`,
        isError: true,
        journalEntryId: req.ids.actionId
      }
    }

    // -0.5 Infinite Loop & Runaway Action Detection
    const loopCheck = costAccounting.checkAndRecordAction(req.ids.taskId, req.tool.name, req.args)
    if (loopCheck.loopDetected) {
      return {
        content: `Error: Infinite action loop detected (${loopCheck.count} repeated consecutive calls). Execution halted to protect system resources.`,
        isError: true,
        journalEntryId: req.ids.actionId
      }
    }

    // 0. Diabaterion Agent Passport Authority & Revocation Verification
    const capability = capabilityForTool(req.tool.name, req.tool.sideEffect)
    const passportCheck = await passportManager.checkAuthority(req.ids.agentId, capability)
    if (!passportCheck.allowed) {
      await actionJournal.append({
        actionId: req.ids.actionId,
        agentId: req.ids.agentId,
        tool: req.tool.name,
        timestamp: new Date().toISOString(),
        idempotencyKey,
        argsDigest: ActionJournal.digest(req.args),
        status: 'denied',
        error: passportCheck.reason ?? 'Diabaterion passport rejected action'
      })
      return {
        content: `Error: Diabaterion Agent Passport rejected execution: ${passportCheck.reason}`,
        isError: true,
        journalEntryId: req.ids.actionId
      }
    }

    // 1. Check Idempotency Cache
    const cached = idempotencyStore.get(idempotencyKey)
    if (cached) {
      return {
        content: cached.result.content,
        isError: Boolean(cached.result.isError),
        cached: true,
        journalEntryId: cached.actionId
      }
    }

    // 2. OpenAI Guardrails Safety Checks
    const guardrailCheck = guardrails.screenToolCall(req.tool.name, req.args)
    if (!guardrailCheck.allowed) {
      const reason = guardrailCheck.violations.map((v) => v.message).join('; ')
      await actionJournal.append({
        actionId: req.ids.actionId,
        agentId: req.ids.agentId,
        tool: req.tool.name,
        timestamp: new Date().toISOString(),
        idempotencyKey,
        argsDigest: ActionJournal.digest(req.args),
        status: 'denied',
        error: `Safety check violation: ${reason}`
      })
      return {
        content: `Tool execution blocked by safety guardrails: ${reason}`,
        isError: true,
        journalEntryId: req.ids.actionId
      }
    }

    // 3. Resource Version Verification (Optimistic Concurrency)
    if (req.versionCheck) {
      const versionResult = await resourceVersionGuard.verifyVersion(req.versionCheck)
      if (!versionResult.valid) {
        await actionJournal.append({
          actionId: req.ids.actionId,
          agentId: req.ids.agentId,
          tool: req.tool.name,
          timestamp: new Date().toISOString(),
          idempotencyKey,
          resourceVersion: req.versionCheck.expectedVersion,
          argsDigest: ActionJournal.digest(req.args),
          status: 'denied',
          error: versionResult.error
        })
        return {
          content: `Execution aborted: ${versionResult.error}`,
          isError: true,
          journalEntryId: req.ids.actionId
        }
      }
    }

    // 4. Pre-execution Journal Append (Write-Ahead Log)
    await actionJournal.append({
      actionId: req.ids.actionId,
      agentId: req.ids.agentId,
      tool: req.tool.name,
      timestamp: new Date().toISOString(),
      idempotencyKey,
      resourceVersion: req.versionCheck?.expectedVersion,
      argsDigest: ActionJournal.digest(req.args),
      status: 'allowed'
    })

    // 5. Execute Tool
    try {
      const outcome = await req.execute()
      const durationMs = Date.now() - started

      // Sanitize untrusted tool return against indirect prompt injection
      const sanitized = untrustedOutputSanitizer.sanitizeToolOutput(req.tool.name, outcome.content)
      const finalContent = sanitized.sanitizedContent

      // Record step into Flight Recorder
      flightRecorder.recordStep(
        req.ids.taskId,
        req.tool.name,
        req.args,
        finalContent
      )

      // Cache successful execution for idempotency
      idempotencyStore.set(idempotencyKey, req.tool.name, req.ids.actionId, {
        ...outcome,
        content: finalContent
      })

      // Post-execution Journal Record
      await actionJournal.append({
        actionId: req.ids.actionId,
        agentId: req.ids.agentId,
        tool: req.tool.name,
        timestamp: new Date().toISOString(),
        idempotencyKey,
        argsDigest: ActionJournal.digest(req.args),
        status: outcome.isError ? 'failed' : 'executed',
        resultDigest: ActionJournal.digest(finalContent),
        durationMs
      })

      return {
        content: finalContent,
        isError: Boolean(outcome.isError),
        journalEntryId: req.ids.actionId
      }
    } catch (err) {
      const durationMs = Date.now() - started
      const errorMsg = err instanceof Error ? err.message : String(err)

      await actionJournal.append({
        actionId: req.ids.actionId,
        agentId: req.ids.agentId,
        tool: req.tool.name,
        timestamp: new Date().toISOString(),
        idempotencyKey,
        argsDigest: ActionJournal.digest(req.args),
        status: 'failed',
        error: errorMsg,
        durationMs
      })

      return {
        content: `Tool execution failed: ${errorMsg}`,
        isError: true,
        journalEntryId: req.ids.actionId
      }
    }
  }
}

export const toolExecutionGateway = new ToolExecutionGateway()
