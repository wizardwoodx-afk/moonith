import { describe, expect, it } from 'vitest'
import { costAccounting } from './costAccounting'
import { earnedAutonomy } from './earnedAutonomy'
import { harnessSquare } from '../harness/harnessSquare'

describe('Operations & Harness² Engine', () => {
  it('records cost telemetry and detects infinite action loops', () => {
    costAccounting.recordUsage('task_loop_1', 10000, 2000)
    const telemetry = costAccounting.getTelemetry('task_loop_1')
    expect(telemetry?.totalInputTokens).toBe(10000)
    expect(telemetry?.estimatedCostUsd).toBeGreaterThan(0)

    // Simulate 4 identical calls
    const check1 = costAccounting.checkAndRecordAction('task_loop_1', 'read_file', { path: 'a.txt' })
    expect(check1.loopDetected).toBe(false)
    costAccounting.checkAndRecordAction('task_loop_1', 'read_file', { path: 'a.txt' })
    costAccounting.checkAndRecordAction('task_loop_1', 'read_file', { path: 'a.txt' })
    const check4 = costAccounting.checkAndRecordAction('task_loop_1', 'read_file', { path: 'a.txt' })
    expect(check4.loopDetected).toBe(true)
    expect(check4.count).toBe(4)
  })

  it('evaluates earned progressive autonomy levels based on verified reliability', () => {
    const profile = earnedAutonomy.getProfile('daedalus_auto')
    expect(profile.level).toBe('supervised')

    // Simulate successful streak with verified proof of work certificates
    for (let i = 0; i < 16; i++) {
      earnedAutonomy.recordTaskOutcome('daedalus_auto', true, false, true)
    }

    const promoted = earnedAutonomy.getProfile('daedalus_auto')
    expect(promoted.level).toBe('autonomous')
    expect(promoted.verifiedProofCount).toBe(16)
    expect(earnedAutonomy.canAutoExecute('daedalus_auto', 'warn')).toBe(true)
  })

  it('runs Google Harness² Propose-Probe-Compose optimization loop', () => {
    const candidate = harnessSquare.proposeCandidate(
      'tool_guidance',
      'Prefer reading whole file chunk rather than 10-line slice.',
      'Improves context synthesis by 28% on benchmark tests.'
    )

    expect(candidate.status).toBe('proposed')

    const probed = harnessSquare.probeCandidate(candidate.id, 0.95)
    expect(probed.status).toBe('probed')
    expect(probed.probeScore).toBe(95)

    const composed = harnessSquare.composeCandidate(candidate.id)
    expect(composed.activeComponents['tool_guidance']).toContain('Prefer reading whole file chunk')
    expect(composed.version).toBeGreaterThan(1)
  })
})
