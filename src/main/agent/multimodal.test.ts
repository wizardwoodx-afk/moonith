import { describe, expect, it } from 'vitest'
import {
  isVisualAttachment,
  isPdfAttachment,
  formatOpenAIUserContent,
  formatAnthropicUserBlocks
} from './multimodal'
import type { ChatMessage } from '@shared/types'
import { join } from 'node:path'
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

describe('Multimodal Vision System', () => {
  it('correctly classifies visual and PDF attachments', () => {
    expect(isVisualAttachment({ id: '1', name: 'screenshot.png', path: '/test.png' })).toBe(true)
    expect(isVisualAttachment({ id: '2', name: 'photo.jpg', path: '/test.jpg' })).toBe(true)
    expect(isVisualAttachment({ id: '3', name: 'doc.pdf', path: '/test.pdf' })).toBe(false)
    expect(isPdfAttachment({ id: '3', name: 'doc.pdf', path: '/test.pdf' })).toBe(true)
    expect(isVisualAttachment({ id: '4', name: 'data.txt', path: '/test.txt' })).toBe(false)
  })

  it('formats text-only messages identically for OpenAI and Anthropic', () => {
    const msg: ChatMessage = {
      id: 'm1',
      role: 'user',
      content: 'Hello agent!',
      createdAt: new Date().toISOString()
    }
    expect(formatOpenAIUserContent(msg)).toBe('Hello agent!')
    const anthropicBlocks = formatAnthropicUserBlocks(msg)
    expect(anthropicBlocks).toEqual([{ type: 'text', text: 'Hello agent!' }])
  })

  it('embeds image base64 into OpenAI and Anthropic content parts', () => {
    const testDir = join(tmpdir(), `mm_test_${Date.now()}`)
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    const imgPath = join(testDir, 'sample.png')
    const sampleBuffer = Buffer.from('fake-png-bytes')
    writeFileSync(imgPath, sampleBuffer)

    try {
      const msg: ChatMessage = {
        id: 'm2',
        role: 'user',
        content: 'Check this image:',
        createdAt: new Date().toISOString(),
        attachments: [
          {
            id: 'a1',
            name: 'sample.png',
            path: imgPath,
            mimeType: 'image/png'
          }
        ]
      }

      const openAiParts = formatOpenAIUserContent(msg)
      expect(Array.isArray(openAiParts)).toBe(true)
      if (Array.isArray(openAiParts)) {
        expect(openAiParts.length).toBe(2)
        expect(openAiParts[0]).toEqual({ type: 'text', text: 'Check this image:' })
        expect(openAiParts[1]).toMatchObject({
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${sampleBuffer.toString('base64')}`
          }
        })
      }

      const anthropicBlocks = formatAnthropicUserBlocks(msg)
      expect(anthropicBlocks.length).toBe(2)
      expect(anthropicBlocks[0]).toEqual({ type: 'text', text: 'Check this image:' })
      expect(anthropicBlocks[1]).toEqual({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: sampleBuffer.toString('base64')
        }
      })
    } finally {
      try {
        unlinkSync(imgPath)
      } catch {}
    }
  })
})
