import type { BackendStore } from './store'

/**
 * Token / credit accounting: daily buckets per agent plus a rolling heatmap.
 * Ported from Seamoon's `electron/backend/usage.js`.
 */

export interface UsageSummaryOptions {
  days?: number
}

export interface UsageDay {
  date: string
  total: number
  level: number
}

export interface UsageTotals {
  prompt: number
  completion: number
  total: number
  calls: number
}

export interface UsageMonthLabel {
  key: string
  label: string
}

export interface UsageSummary {
  days: UsageDay[]
  totals: UsageTotals
  byAgent: Record<string, number>
  monthLabels: UsageMonthLabel[]
}

export class Usage {
  readonly store: BackendStore

  constructor(store: BackendStore) {
    this.store = store
  }

  summary({ days = 84 }: UsageSummaryOptions = {}): UsageSummary {
    const buckets = this.store.usage.all()
    const byDay = new Map<string, number>()
    for (const b of buckets) {
      byDay.set(b.day, (byDay.get(b.day) || 0) + (b.total || 0))
    }

    const days_: UsageDay[] = []
    const today = new Date()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000)
      const key = d.toISOString().slice(0, 10)
      const total = byDay.get(key) || 0
      days_.push({ date: key, total, level: Usage.level(total) })
    }

    const totals = buckets.reduce<UsageTotals>(
      (acc, b) => {
        acc.prompt += b.prompt || 0
        acc.completion += b.completion || 0
        acc.total += b.total || 0
        acc.calls += b.calls || 0
        return acc
      },
      { prompt: 0, completion: 0, total: 0, calls: 0 }
    )

    const byAgent: Record<string, number> = {}
    for (const b of buckets) {
      byAgent[b.agentId] = (byAgent[b.agentId] || 0) + (b.total || 0)
    }

    const monthLabels: UsageMonthLabel[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      // zero padded, so it matches the ISO date prefix the heatmap slices off
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthLabels.push({ key, label: d.toLocaleString('en-US', { month: 'short' }) })
    }

    return { days: days_, totals, byAgent, monthLabels }
  }

  static level(total: number): number {
    if (!total) return 0
    if (total < 2000) return 1
    if (total < 10000) return 2
    if (total < 40000) return 3
    if (total < 120000) return 4
    return 5
  }
}
