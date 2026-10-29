import { describe, expect, it } from 'vitest'
import {
  comparePolicyArms,
  policyComplexityPenalty,
  regularizedPolicyScore,
  type MeasuredPolicyRun,
  type PolicyComplexity
} from './rsiralsPolicy'

const params: PolicyComplexity = {
  reviewDepth: 1,
  checkBias: 0.5,
  serialExec: false,
  lessonBudget: 3,
  mosaic: false
}

const runs = (verified: boolean, count: number, extra: Partial<MeasuredPolicyRun> = {}): MeasuredPolicyRun[] =>
  Array.from({ length: count }, () => ({ verified, simulated: false, ...extra }))

const comparison = (
  baselineRuns: MeasuredPolicyRun[],
  candidateRuns: MeasuredPolicyRun[],
  candidateParams = params
) =>
  comparePolicyArms({
    baselineRuns,
    candidateRuns,
    baselineParams: params,
    candidateParams,
    minTrials: 3,
    adoptMargin: 0.05
  })

describe('RSIRALS regularized policy evaluation', () => {
  it('excludes simulations and contaminated evidence instead of treating them as failures', () => {
    const score = regularizedPolicyScore(
      [
        ...runs(true, 1),
        ...runs(false, 4, { simulated: true }),
        ...runs(false, 4, { evidenceLeak: true })
      ],
      params
    )
    expect(score.measured).toBe(1)
    expect(score.quality).toBe(1)
  })

  it('makes measured cost, token use, and policy complexity explicit penalties', () => {
    const lean = regularizedPolicyScore(runs(true, 4), params)
    const expensive = regularizedPolicyScore(
      runs(true, 4, { costUsd: 4, policyTokens: 80_000 }),
      { ...params, reviewDepth: 2, serialExec: true, lessonBudget: 8, mosaic: true }
    )
    expect(expensive.score).toBeLessThan(lean.score as number)
    expect(expensive.meanCostUsd).toBe(4)
    expect(expensive.meanPolicyTokens).toBe(80_000)
    expect(expensive.complexityPenalty).toBeGreaterThan(policyComplexityPenalty(params))
  })

  it('waits for balanced development evidence', () => {
    const result = comparison(runs(false, 3), runs(true, 2))
    expect(result.decision).toBe('wait')
    expect(result.reason).toContain('development runs')
  })

  it('requires a separate held-out pair after a promising development result', () => {
    const result = comparison(runs(false, 3), runs(true, 3))
    expect(result.decision).toBe('wait')
    expect(result.reason).toContain('held-out')
  })

  it('rejects a development gain that regresses on held-out transfer', () => {
    const result = comparison(
      [...runs(false, 3), ...runs(true, 1, { heldOut: true })],
      [...runs(true, 3), ...runs(false, 1, { heldOut: true })]
    )
    expect(result.decision).toBe('retire')
    expect(result.reason).toContain('transfer regressed')
  })

  it('adopts only when the regularized margin and held-out transfer both pass', () => {
    const result = comparison(
      [...runs(false, 3), ...runs(true, 1, { heldOut: true })],
      [...runs(true, 3), ...runs(true, 1, { heldOut: true })]
    )
    expect(result.decision).toBe('adopt')
    expect(result.developmentMargin).toBeGreaterThan(0.05)
  })

  it('does not let a favourable held-out run rescue a losing development arm', () => {
    const result = comparison(
      [...runs(true, 3), ...runs(false, 1, { heldOut: true })],
      [...runs(false, 3), ...runs(true, 1, { heldOut: true })]
    )
    expect(result.decision).toBe('retire')
    expect(result.reason).toContain('development margin')
  })

  it('scores an unreadable run record as absent evidence, never as a measured success', () => {
    const score = regularizedPolicyScore(
      [{ verified: 'true', simulated: false, heldOut: false } as unknown as MeasuredPolicyRun],
      params
    )
    expect(score.measured).toBe(0)
    expect(score.quality).toBeNull()
  })

  it('drops null and non-boolean-flagged run records instead of trusting or throwing on them', () => {
    const score = regularizedPolicyScore(
      [
        null,
        { verified: true, simulated: false, evidenceLeak: 'yes' }
      ] as unknown as MeasuredPolicyRun[],
      params
    )
    expect(score.measured).toBe(0)
    expect(score.score).toBeNull()
  })

  it('keeps the complexity penalty finite when persisted parameters are unreadable', () => {
    expect(policyComplexityPenalty({} as unknown as PolicyComplexity)).toBe(0)
  })

  it('refuses to adopt when an arm has missing or malformed policy parameters', () => {
    const result = comparePolicyArms({
      baselineRuns: [...runs(false, 3), ...runs(true, 1, { heldOut: true })],
      candidateRuns: [...runs(true, 3), ...runs(true, 1, { heldOut: true })],
      baselineParams: params,
      candidateParams: { ...params, reviewDepth: undefined } as unknown as PolicyComplexity,
      minTrials: 3,
      adoptMargin: 0.05
    })
    expect(result.decision).toBe('wait')
    expect(result.awaitingHeldOut).toBe(false)
  })

  it('refuses to adopt when the acceptance gate itself receives non-finite thresholds', () => {
    const arms = {
      baselineRuns: [...runs(false, 3), ...runs(true, 1, { heldOut: true })],
      candidateRuns: [...runs(true, 3), ...runs(true, 1, { heldOut: true })],
      baselineParams: params,
      candidateParams: params
    }
    const badMargin = comparePolicyArms({ ...arms, minTrials: 3, adoptMargin: Number.NaN })
    const badTrials = comparePolicyArms({ ...arms, minTrials: Number.NaN, adoptMargin: 0.05 })
    expect(badMargin.decision).toBe('wait')
    expect(badMargin.awaitingHeldOut).toBe(false)
    expect(badTrials.decision).toBe('wait')
    expect(badTrials.awaitingHeldOut).toBe(false)
  })
})
