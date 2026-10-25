import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storeMock = vi.hoisted(() => ({
  getProvider: vi.fn(),
  getProviderSecret: vi.fn()
}))

vi.mock('../../store', () => ({ store: storeMock }))

import { fetchProviderModels } from './index'

const input = {
  id: 'custom',
  name: 'Custom',
  kind: 'compatible' as const,
  models: [],
  enabled: true
}

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.restoreAllMocks()
  storeMock.getProvider.mockReset()
  storeMock.getProviderSecret.mockReset()
  storeMock.getProvider.mockReturnValue({ baseUrl: 'https://custom.example/v1' })
  storeMock.getProviderSecret.mockReturnValue('stored-secret')
})

describe('provider endpoint and credential binding', () => {
  it('uses the stored endpoint when a redundant URL is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'model-one' }] })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchProviderModels(input)).resolves.toEqual(['model-one'])
    expect(fetchMock).toHaveBeenCalledWith('https://custom.example/v1/models', expect.objectContaining({
      headers: { Authorization: 'Bearer stored-secret' }
    }))
  })

  it('does not reuse a stored key for a changed endpoint', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchProviderModels({ ...input, baseUrl: 'https://other.example/v1' })).rejects.toThrow('Add an API key')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
