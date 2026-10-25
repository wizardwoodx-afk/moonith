import { isAbsolute } from 'node:path'

export function safeGroundedWebUrl(value: string): string | null {
  const raw = value.trim()
  if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

/** openPath requires an absolute path; application names are not shell commands. */
export function safeGroundedApplicationPath(value: string): string | null {
  const raw = value.trim()
  if (!raw || raw.length > 4096 || raw.includes('\0') || !isAbsolute(raw)) return null
  return raw
}
