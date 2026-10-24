import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNowStrict, isToday, isYesterday, format } from 'date-fns'
import type { ArtifactKind, TaskStatus } from '@shared/types'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

export function fileUrl(taskId: string, relPath: string): string {
  const encoded = relPath
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
  return `knight-file://file/${encodeURIComponent(taskId)}/${encoded}`
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024
    return `${kb < 10 ? (Number.isInteger(kb) ? kb.toFixed(0) : kb.toFixed(1)) : Math.round(kb)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function timeAgo(iso?: string): string {
  if (!iso) return ''
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

export function taskGroup(iso: string): 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older' {
  const date = new Date(iso)
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  if (Date.now() - date.getTime() < 7 * 24 * 60 * 60 * 1000) return 'Previous 7 days'
  return 'Older'
}

export function shortDate(iso?: string): string {
  if (!iso) return ''
  try {
    return format(new Date(iso), 'MMM d, HH:mm')
  } catch {
    return ''
  }
}

export function statusLabel(status: TaskStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'running':
      return 'Working'
    case 'waiting':
      return 'Waiting for you'
    case 'paused':
      return 'Paused'
    case 'done':
      return 'Done'
    case 'error':
      return 'Needs attention'
    default:
      return status
  }
}

export function kindLabel(kind: ArtifactKind): string {
  switch (kind) {
    case 'document':
      return 'Document'
    case 'spreadsheet':
      return 'Spreadsheet'
    case 'presentation':
      return 'Presentation'
    case 'pdf':
      return 'PDF'
    case 'image':
      return 'Image'
    case 'text':
      return 'Text'
    case 'code':
      return 'Code'
    default:
      return 'File'
  }
}

export function cronDescription(cron: string): string {
  const map: Record<string, string> = {
    '0 9 * * *': 'Every day at 09:00',
    '0 9 * * 1-5': 'Weekdays at 09:00',
    '0 17 * * 1-5': 'Weekdays at 17:00',
    '0 9 * * 1': 'Every Monday at 09:00',
    '0 * * * *': 'Every hour',
    '*/30 * * * *': 'Every 30 minutes',
    '0 8 1 * *': 'First of the month at 08:00'
  }
  const normalized = cron.trim()
  if (map[normalized]) return map[normalized]
  const fixed = /^(\d{1,2})\s+(\d{1,2})\s+(.+)$/.exec(normalized)
  if (fixed) {
    const minute = Number(fixed[1])
    const hour = Number(fixed[2])
    if (minute < 60 && hour < 24) {
      const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      const suffix = fixed[3]
      if (suffix === '* * *') return `Every day at ${time}`
      if (suffix === '* * 1-5') return `Weekdays at ${time}`
      if (suffix === '* * 1') return `Every Monday at ${time}`
      if (suffix === '1 * *') return `First of the month at ${time}`
    }
  }
  return 'Custom schedule'
}

export function countdownHint(): string {
  return 'Runs while SelfImpulse is open'
}

export function truncate(value: string, max = 120): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

export function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function plural(count: number, word: string, pluralWord?: string): string {
  return `${count} ${count === 1 ? word : (pluralWord ?? `${word}s`)}`
}
