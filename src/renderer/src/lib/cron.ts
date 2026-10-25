export function cronTimeMinutes(cron: string): number | null {
  const match = /^\s*(\d{1,2})\s+(\d{1,2})(?:\s+|$)/.exec(cron)
  if (!match) return null
  const minute = Number(match[1])
  const hour = Number(match[2])
  if (minute > 59 || hour > 23) return null
  return hour * 60 + minute
}

export function replaceCronTime(cron: string, minutes: number): string {
  const fields = cron.trim().split(/\s+/)
  if (fields.length < 5) return cron
  const value = Math.max(0, Math.min(1439, Math.round(minutes)))
  fields[0] = String(value % 60)
  fields[1] = String(Math.floor(value / 60))
  return fields.join(' ')
}
