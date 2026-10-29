import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, isAbsolute, join } from 'node:path'
import type { AttachmentRef, ChatMessage } from '@shared/types'
import type OpenAI from 'openai'
import type Anthropic from '@anthropic-ai/sdk'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB per image
const MAX_PDF_BYTES = 15 * 1024 * 1024 // 15 MB per PDF

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

export function isVisualAttachment(att: AttachmentRef): boolean {
  const ext = extname(att.name || att.path || '').toLowerCase()
  if (IMAGE_EXTENSIONS[ext]) return true
  if (att.mimeType && att.mimeType.startsWith('image/')) return true
  return false
}

export function isPdfAttachment(att: AttachmentRef): boolean {
  const ext = extname(att.name || att.path || '').toLowerCase()
  return ext === '.pdf' || att.mimeType === 'application/pdf'
}

export function resolveAttachmentMime(att: AttachmentRef): string {
  const ext = extname(att.name || att.path || '').toLowerCase()
  if (IMAGE_EXTENSIONS[ext]) return IMAGE_EXTENSIONS[ext]
  if (ext === '.pdf') return 'application/pdf'
  return att.mimeType || 'application/octet-stream'
}

export function loadAttachmentBase64(
  att: AttachmentRef,
  workspace?: string
): { mime: string; base64: string; isPdf: boolean } | null {
  try {
    let filePath = att.path
    if (!isAbsolute(filePath) && workspace) {
      filePath = join(workspace, att.relPath || att.path)
    }
    if (!existsSync(filePath)) {
      if (workspace) {
        const fallback = join(workspace, 'attachments', att.name)
        if (existsSync(fallback)) filePath = fallback
        else return null
      } else {
        return null
      }
    }

    const stat = statSync(filePath)
    const isPdf = isPdfAttachment(att)
    const maxBytes = isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
    if (stat.size > maxBytes || stat.size === 0) return null

    const buffer = readFileSync(filePath)
    const mime = resolveAttachmentMime(att)
    return {
      mime,
      base64: buffer.toString('base64'),
      isPdf
    }
  } catch {
    return null
  }
}

/**
 * Transforms a user chat message into OpenAI's multimodal content array
 * when image attachments are present, or returns the raw text string.
 */
export function formatOpenAIUserContent(
  message: ChatMessage,
  workspace?: string
): string | OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  const text = message.content || ''
  const attachments = message.attachments || []
  const visualAttachments = attachments.filter(isVisualAttachment)

  if (!visualAttachments.length) {
    return text
  }

  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = []
  if (text.trim()) {
    parts.push({ type: 'text', text })
  }

  for (const att of visualAttachments) {
    const loaded = loadAttachmentBase64(att, workspace)
    if (loaded && !loaded.isPdf) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${loaded.mime};base64,${loaded.base64}`
        }
      })
    }
  }

  return parts.length ? parts : text
}

/**
 * Transforms a user chat message into Anthropic content blocks with image and PDF document support.
 */
export function formatAnthropicUserBlocks(
  message: ChatMessage,
  workspace?: string
): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = []
  const text = message.content?.trim()
  if (text) {
    blocks.push({ type: 'text', text })
  }

  const attachments = message.attachments || []
  for (const att of attachments) {
    const loaded = loadAttachmentBase64(att, workspace)
    if (!loaded) continue

    if (loaded.isPdf) {
      blocks.push({
        type: 'document' as const,
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: loaded.base64
        }
      } as unknown as Anthropic.ContentBlockParam)
    } else {
      const mediaType = loaded.mime as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: loaded.base64
        }
      })
    }
  }

  return blocks
}
