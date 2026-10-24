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
})
