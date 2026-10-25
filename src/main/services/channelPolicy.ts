import type { DlpSettings } from '@shared/governance'
import { inspectSensitiveText } from '../selfimpulse/governance/dlp'

export function telegramChatAuthorized(allowedChatIds: readonly string[], chatId: string | number): boolean {
  const id = String(chatId)
  return allowedChatIds.includes(id)
}

export function protectChannelReply(
  reply: string,
  settings: DlpSettings
): { text: string | null; blocked: boolean; findings: number } {
  if (settings.mode === 'off') return { text: reply, blocked: false, findings: 0 }
  const inspection = inspectSensitiveText(reply, settings.categories)
  if (settings.mode === 'block' && inspection.total > 0) {
    return { text: null, blocked: true, findings: inspection.total }
  }
  return {
    text: settings.mode === 'redact' ? inspection.redacted : reply,
    blocked: false,
    findings: inspection.total
  }
}
