import type { AgentUsage, TokenUsage, UsageDay, UsageSummary } from '@shared/types'
import { getPaths } from '../paths'
import { atomicWriteJson, nowIso, readJson } from '../util'

const RETAIN_DAYS = 400

export interface UsageRecord {
  agentId: string
  providerId: string
  model: string
  usage?: TokenUsage
}

interface UsageBucket {
  day: string
  agentId: string
  providerId: string
  model: string
  input: number
  output: number
  total: number
  calls: number
  lastUsedAt: string
}

export function dayKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function usageLevel(total: number): number {
  if (total <= 0) return 0
  if (total < 2_000) return 1
  if (total < 10_000) return 2
  if (total < 40_000) return 3
  if (total < 120_000) return 4
  return 5
}

function bucketKey(bucket: Pick<UsageBucket, 'day' | 'agentId' | 'providerId' | 'model'>): string {
  return `${bucket.day}|${bucket.agentId}|${bucket.providerId}|${bucket.model}`
}

function totalsFor(buckets: UsageBucket[]): { input: number; output: number; total: number; calls: number } {
  return buckets.reduce(
    (sum, bucket) => ({
      input: sum.input + bucket.input,
      output: sum.output + bucket.output,
      total: sum.total + bucket.total,
      calls: sum.calls + bucket.calls
    }),
    { input: 0, output: 0, total: 0, calls: 0 }
  )
}

export class UsageLedger {
  private buckets: UsageBucket[] | null = null

  private async load(): Promise<UsageBucket[]> {
    if (this.buckets) return this.buckets
    const raw = await readJson<UsageBucket[]>(getPaths().usageFile, [])
    this.buckets = Array.isArray(raw)
      ? raw.filter(
          (bucket) =>
            bucket &&
            typeof bucket.day === 'string' &&
            typeof bucket.agentId === 'string' &&
            Number.isFinite(bucket.total)
        )
      : []
    return this.buckets
  }

  async record(entry: UsageRecord): Promise<void> {
    const buckets = await this.load()
    const input = Math.max(0, entry.usage?.input ?? 0)
    const output = Math.max(0, entry.usage?.output ?? 0)
    const total = Math.max(entry.usage?.total ?? 0, input + output)
    const draft = {
      day: dayKey(),
      agentId: entry.agentId,
      providerId: entry.providerId,
      model: entry.model
    }
    const key = bucketKey(draft)
    const existing = buckets.find((bucket) => bucketKey(bucket) === key)
    const lastUsedAt = nowIso()
    if (existing) {
      existing.input += input
      existing.output += output
      existing.total += total
      existing.calls += 1
      existing.lastUsedAt = lastUsedAt
    } else {
      buckets.push({ ...draft, input, output, total, calls: 1, lastUsedAt })
    }

    const cutoff = dayKey(new Date(Date.now() - RETAIN_DAYS * 86_400_000))
    this.buckets = buckets.filter((bucket) => bucket.day >= cutoff)
    await atomicWriteJson(getPaths().usageFile, this.buckets)
  }

  async summary(days = 84): Promise<UsageSummary> {
    const buckets = await this.load()
    const byDay = new Map<string, number>()
    for (const bucket of buckets) {
      byDay.set(bucket.day, (byDay.get(bucket.day) ?? 0) + bucket.total)
    }

    const today = new Date()
    const grid: UsageDay[] = []
    for (let offset = days - 1; offset >= 0; offset--) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
      const key = dayKey(date)
      const total = byDay.get(key) ?? 0
      grid.push({ date: key, total, level: usageLevel(total) })
    }

    const agents = new Map<string, AgentUsage>()
    for (const bucket of buckets) {
      const current = agents.get(bucket.agentId) ?? {
        agentId: bucket.agentId,
        input: 0,
        output: 0,
        total: 0,
        calls: 0,
        lastUsedAt: bucket.lastUsedAt
      }
      current.input += bucket.input
      current.output += bucket.output
      current.total += bucket.total
      current.calls += bucket.calls
      if (bucket.lastUsedAt > current.lastUsedAt) current.lastUsedAt = bucket.lastUsedAt
      agents.set(bucket.agentId, current)
    }

    return {
      days: grid,
      totals: totalsFor(buckets),
      byAgent: [...agents.values()].sort((a, b) => b.total - a.total)
    }
  }
}

export const usageService = new UsageLedger()
