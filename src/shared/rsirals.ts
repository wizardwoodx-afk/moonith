export const RSIRALS_IPC = {
  snapshot: 'rsirals:snapshot'
} as const

export interface RsiralsSnapshot {
  name: 'RSIRALS'
  fullName: 'Recursive Self-Improving Reinforcement Agentic Learning System'
  mode: 'non-parametric-runtime-learning'
  adopted: {
    id: string
    gen: number
    score: number | null
    evaluatedOn: number
    note: string
    params: {
      reviewDepth: number
      checkBias: number
      serialExec: boolean
      lessonBudget: number
      mosaic: boolean
    }
  } | null
  candidate: {
    id: string
    gen: number
    score: number | null
    evaluatedOn: number
    note: string
  } | null
  runs: Array<{
    strategyId: string | null
    verified: boolean
    simulated: boolean
    heldOut: boolean
    evidenceLeak: boolean
    costUsd: number | null
    policyTokens: number | null
  }>
  lessons: Array<{
    id: string
    kind: string
    text: string
    strength: number
    utility: number
    utilityCount: number
    retrievalCount: number
    evidence: string[]
  }>
  skills: { proposed: number; approved: number; discarded: number }
  receipts: Array<{
    id: string
    at: string
    missionId: string
    strategyChange: string | null
    evidenceDigest: string
    signed: boolean
    memoryCredit: { lessonIds: string[]; verified: boolean; model: string } | null
    evaluation: {
      heldOut: boolean
      evidenceLeak: boolean
      costUsd: number | null
      policyTokens: number | null
    } | null
  }>
  acceptanceRule: string
  boundaries: string[]
}
