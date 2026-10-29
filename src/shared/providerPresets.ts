import type { ProviderKind } from './types'

export type ProviderPresetCategory = 'frontier' | 'fast' | 'aggregator' | 'local'

export interface ProviderPreset {
  id: string
  name: string
  kind: ProviderKind
  baseUrl?: string
  models: string[]
  category: ProviderPresetCategory
  note: string
}

/**
 * Endpoints the user can pick instead of typing every field. Model ids are a
 * starting point only: the provider modal can fetch the live list after a key
 * is entered, so a stale id costs one extra click, never a dead end.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    category: 'frontier',
    note: 'Claude, native endpoint.'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
    category: 'frontier',
    note: 'GPT models, native endpoint.'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    category: 'frontier',
    note: 'Gemini through its OpenAI-compatible API.'
  },
  {
    id: 'zai',
    name: 'Z.AI',
    kind: 'compatible',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5-air'],
    category: 'frontier',
    note: 'GLM models.'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    category: 'fast',
    note: 'Chat and reasoning models.'
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    kind: 'compatible',
    baseUrl: 'https://api.moonshot.ai/v1',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-128k'],
    category: 'fast',
    note: 'Kimi models, long context.'
  },
  {
    id: 'qwen',
    name: 'Qwen',
    kind: 'compatible',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3-coder-plus', 'qwen-plus'],
    category: 'fast',
    note: 'Alibaba Cloud international endpoint.'
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    kind: 'compatible',
    baseUrl: 'https://api.minimax.io/v1',
    models: ['MiniMax-M2'],
    category: 'fast',
    note: 'MiniMax chat models.'
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'codestral-latest'],
    category: 'fast',
    note: 'Large and coding models.'
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
    category: 'fast',
    note: 'Very low latency inference.'
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    kind: 'compatible',
    baseUrl: 'https://api.cerebras.ai/v1',
    models: ['gpt-oss-120b'],
    category: 'fast',
    note: 'Wafer-scale inference.'
  },
  {
    id: 'xai',
    name: 'xAI',
    kind: 'compatible',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-code-fast-1'],
    category: 'frontier',
    note: 'Grok models.'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5'],
    category: 'aggregator',
    note: 'One key, many vendors.'
  },
  {
    id: 'together',
    name: 'Together',
    kind: 'compatible',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    category: 'aggregator',
    note: 'Open models hosted together.'
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    kind: 'compatible',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    models: ['accounts/fireworks/models/llama-v3p3-70b-instruct'],
    category: 'aggregator',
    note: 'Open models on fast serving.'
  },
  {
    id: 'github-models',
    name: 'GitHub Models',
    kind: 'compatible',
    baseUrl: 'https://models.github.ai/inference',
    models: ['openai/gpt-4.1'],
    category: 'aggregator',
    note: 'Models behind your GitHub account.'
  },
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['llama3.2'],
    category: 'local',
    note: 'Runs on this machine, no key.'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    kind: 'compatible',
    baseUrl: 'http://127.0.0.1:1234/v1',
    models: ['local-model'],
    category: 'local',
    note: 'Local server opened from LM Studio.'
  },
  {
    id: 'vllm',
    name: 'vLLM',
    kind: 'compatible',
    baseUrl: 'http://127.0.0.1:8000/v1',
    models: ['local-model'],
    category: 'local',
    note: 'Your own vLLM server.'
  }
]

export const PRESET_CATEGORY_LABELS: Record<ProviderPresetCategory, string> = {
  frontier: 'Frontier',
  fast: 'Fast',
  aggregator: 'Aggregators',
  local: 'Local'
}
