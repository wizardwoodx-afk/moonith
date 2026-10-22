import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { ProviderInput, TestProviderResult } from '@shared/types'
import { store } from '../../store'
import type { CompletionRequest, CompletionResult } from '../types'
import { streamAnthropic } from './anthropic'
import { streamOpenAI } from './openai'

export async function streamCompletion(request: CompletionRequest): Promise<CompletionResult> {
  if (!request.apiKey) throw new Error('No API key configured for this provider.')
  if (request.kind === 'anthropic') return streamAnthropic(request)
  return streamOpenAI(request)
}

function resolveKey(input: ProviderInput): string | undefined {
  return input.apiKey?.trim() || (input.id ? store.getProviderSecret(input.id) : undefined)
}

function friendlyError(error: unknown): string {
  if (error instanceof Error) {
    const anyError = error as Error & { status?: number }
    if (anyError.status === 401) return 'Authentication failed. Check the API key.'
    if (anyError.status === 403) return 'Access denied for this key or model.'
    if (anyError.status === 404) return 'Endpoint or model not found. Check the base URL and model id.'
    if (anyError.status === 429) return 'Rate limited by the provider. Try again shortly.'
    if (/ENOTFOUND|ECONNREFUSED|fetch failed/i.test(error.message)) {
      return 'Could not reach the provider. Check your network and base URL.'
    }
    return error.message
  }
  return String(error)
}

async function listModels(input: ProviderInput, key: string): Promise<string[]> {
  if (input.kind === 'anthropic') {
    const client = new Anthropic({ apiKey: key, baseURL: input.baseUrl || undefined })
    const result = await client.models.list({ limit: 100 })
    return result.data.map((model) => model.id)
  }

  if (input.kind === 'openai') {
    const client = new OpenAI({ apiKey: key, baseURL: input.baseUrl || undefined })
    const result = await client.models.list()
    return result.data.map((model) => model.id).sort()
  }

  const base = (input.baseUrl || '').replace(/\/+$/, '')
  if (!base) throw new Error('A base URL is required for OpenAI-compatible providers.')
  const response = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${key}` }
  })
  if (!response.ok) throw new Error(`Models request failed (${response.status}).`)
  const json = (await response.json()) as { data?: Array<{ id?: string }> }
  return (json.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id))
}

export async function verifyProvider(input: ProviderInput): Promise<TestProviderResult> {
  const key = resolveKey(input)
  if (!key) return { ok: false, message: 'Add an API key first.' }
  if (input.kind === 'compatible' && !input.baseUrl?.trim()) {
    return { ok: false, message: 'Add a base URL for this provider.' }
  }
  try {
    const models = await listModels(input, key)
    return {
      ok: true,
      message: models.length
        ? `Connected · ${models.length} models available`
        : 'Connected successfully',
      models
    }
  } catch (error) {
    return { ok: false, message: friendlyError(error) }
  }
}

export async function fetchProviderModels(input: ProviderInput): Promise<string[]> {
  const key = resolveKey(input)
  if (!key) throw new Error('Add an API key first.')
  return listModels(input, key)
}

export function providerError(error: unknown): string {
  return friendlyError(error)
}
