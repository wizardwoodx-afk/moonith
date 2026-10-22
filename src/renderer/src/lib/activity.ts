import type { TaskSummary } from '@shared/types'

export type ActivityMetric = 'sessions' | 'receipts'

export interface ActivityDay {
  date: string
  count: number
  level: number
}

export interface ActivityMonth {
  index: number
  label: string
}

export interface ActivityStats {
  total: number
  peak: number
  streak: number
  activeDays: number
}

export interface ActivityGrid {
  columns: ActivityDay[][]
  months: ActivityMonth[]
  stats: ActivityStats
  days: ActivityDay[]
}

const DAYS = 364
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function atNoon(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(12, 0, 0, 0)
  return copy
}

export function activityLevel(count: number): number {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count === 2) return 2
  if (count <= 4) return 3
  if (count <= 7) return 4
  return 5
}

export function buildActivity(
  tasks: Pick<TaskSummary, 'updatedAt' | 'artifactsCount'>[],
  metric: ActivityMetric = 'sessions',
  now: Date = new Date()
): ActivityGrid {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    const date = new Date(task.updatedAt)
    if (Number.isNaN(date.getTime())) continue
    const key = dayKey(date)
    const value = metric === 'receipts' ? Math.max(1, task.artifactsCount) : 1
    counts.set(key, (counts.get(key) ?? 0) + value)
  }

  const today = atNoon(now)
  const start = new Date(today)
  start.setDate(start.getDate() - (DAYS - 1))

  const columns: ActivityDay[][] = []
  const days: ActivityDay[] = []
  for (let column = 0; column < 52; column++) {
    const cells: ActivityDay[] = []
    for (let row = 0; row < 7; row++) {
      const date = new Date(start)
      date.setDate(start.getDate() + column * 7 + row)
      const key = dayKey(date)
      const count = date.getTime() > today.getTime() ? 0 : (counts.get(key) ?? 0)
      const cell = { date: key, count, level: activityLevel(count) }
      cells.push(cell)
      if (date.getTime() <= today.getTime()) days.push(cell)
    }
    columns.push(cells)
  }

  const months: ActivityMonth[] = []
  let lastMonth = ''
  columns.forEach((column, index) => {
    const month = column[0].date.slice(0, 7)
    if (month === lastMonth) return
    lastMonth = month
    const monthNumber = Number(month.slice(5, 7))
    months.push({ index, label: MONTH_SHORT[monthNumber - 1] ?? '' })
  })

  const active = days.filter((day) => day.count > 0)
  const total = days.reduce((sum, day) => sum + day.count, 0)
  const peak = active.reduce((max, day) => Math.max(max, day.count), 0)

  let streak = 0
  for (let offset = 0; offset < days.length; offset++) {
    const key = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset))
    const entry = counts.get(key) ?? 0
    if (entry > 0) streak++
    else if (offset > 0) break
  }

  return {
    columns,
    months,
    days,
    stats: { total, peak, streak, activeDays: active.length }
  }
}
