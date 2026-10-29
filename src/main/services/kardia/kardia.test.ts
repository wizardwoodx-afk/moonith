import { describe, expect, it } from 'vitest'
import { KardiaEvaluator } from './evaluator'
import { KardiaHeartbeat } from './heartbeat'

describe('Kardia (Pulse) Proactive Awareness Subsystem', () => {
  it('returns PULSE_OK when context is quiet with no pending items', async () => {
    const evaluator = new KardiaEvaluator()
    const result = await evaluator.evaluate({
      pendingApprovalsCount: 0,
      enabledSchedulesCount: 2
    })

    expect(result.status).toBe('PULSE_OK')
    expect(result.actionItems).toBeUndefined()
  })

  it('triggers ATTENTION_NEEDED when pending approvals are detected', async () => {
    const evaluator = new KardiaEvaluator()
    const result = await evaluator.evaluate({
      pendingApprovalsCount: 2
    })

    expect(result.status).toBe('ATTENTION_NEEDED')
    expect(result.actionItems?.length).toBe(1)
    expect(result.actionItems?.[0]).toContain('2 pending tool approvals')
  })

  it('emits notification to registered handler when attention is needed', async () => {
    const heartbeat = new KardiaHeartbeat()
    let receivedNotice: string | undefined

    heartbeat.setNotificationHandler((evaluation) => {
      receivedNotice = evaluation.summary
    })

    heartbeat.setContextProvider(async () => ({
      pendingApprovalsCount: 1
    }))

    const evaluation = await heartbeat.beat()
    expect(evaluation.status).toBe('ATTENTION_NEEDED')
    expect(receivedNotice).toContain('Kardia detected 1 item(s)')
  })
})
