import { describe, expect, it } from 'vitest'
import { toffoliClassifier } from './classifier'
import { toffoliPlanner } from './planner'
import { recoveryDispatcher } from './dispatcher'

describe('Toffoli Recovery Subsystem', () => {
  it('classifies transient network errors and plans delayed retry', () => {
    const error = new Error('getaddrinfo ENOTFOUND api.openai.com')
    const fault = toffoliClassifier.classify(error)

    expect(fault.category).toBe('transient_network')
    expect(fault.retryable).toBe(true)
    expect(fault.requiresRollback).toBe(false)

    const plan = toffoliPlanner.plan(fault)
    expect(plan.strategy).toBe('delayed_retry')
    expect(plan.actions[0].kind).toBe('retry_delayed')
  })

  it('classifies version conflict and plans immediate rollback with walkback', () => {
    const error = new Error('Resource version conflict: hash mismatch')
    const fault = toffoliClassifier.classify(error)

    expect(fault.category).toBe('resource_conflict')
    expect(fault.requiresRollback).toBe(true)

    const plan = toffoliPlanner.plan(fault, {
      taskId: 'task-10',
      affectedPath: 'src/main.ts'
    })

    expect(plan.strategy).toBe('immediate_rollback')
    expect(plan.actions.some((a) => a.kind === 'walkback_file')).toBe(true)
  })

  it('registers and executes domain compensation adapters', async () => {
    let compensated = false
    recoveryDispatcher.registerDomainAdapter('stripe_payments', async (actionId, context) => {
      compensated = true
      return { success: true, note: `Refunded charge for action ${actionId}` }
    })

    const fault = toffoliClassifier.classify(new Error('Payment side effect failed'), { isSideEffect: true })
    const plan = toffoliPlanner.plan(fault, {
      taskId: 'task-99',
      domain: 'stripe_payments'
    })

    const results = await recoveryDispatcher.dispatch(plan, { taskId: 'task-99', actionId: 'act-refund-1' })
    expect(compensated).toBe(true)
    expect(results.some((r) => r.success && r.detail.includes('Refunded charge'))).toBe(true)
  })
})
