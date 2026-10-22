import { describe, expect, it } from 'vitest'
import type { ProviderPublic } from '@shared/types'
import {
  PERMISSION_CHOICES,
  composerModelLabel,
  permissionChoice,
  resolveComposerModel,
  usableProviders
} from './composerChoices'

function provider(overrides: Partial<ProviderPublic> = {}): ProviderPublic {
  return {
    id: 'p1',
    name: 'Anthropic',
    kind: 'anthropic',
    models: ['claude-sonnet', 'claude-haiku'],
    enabled: true,
    hasKey: true,
    ...overrides
  }
}

describe('permission choices', () => {
  it('offers manual, auto and skip in order', () => {
    expect(PERMISSION_CHOICES.map((item) => item.value)).toEqual(['manual', 'auto', 'skip'])
  })

  it('maps each mode to a short label and a description', () => {
    expect(permissionChoice('manual').label).toBe('Manual')
    expect(permissionChoice('auto').label).toBe('Auto')
    expect(permissionChoice('skip').label).toBe('Integrated acceptance')
    expect(permissionChoice('skip').blurb).toContain('without asking')
  })
})

describe('composer model selection', () => {
  it('keeps only enabled providers that expose models', () => {
    const settings = {
      providers: [
        provider(),
        provider({ id: 'off', enabled: false }),
        provider({ id: 'empty', models: [] })
      ],
      defaultProviderId: 'p1'
    }
    expect(usableProviders(settings).map((item) => item.id)).toEqual(['p1'])
    expect(usableProviders(null)).toEqual([])
  })

  it('honours an explicit provider and model', () => {
    const settings = {
      providers: [provider(), provider({ id: 'p2', name: 'Local', models: ['qwen'] })],
      defaultProviderId: 'p1',
      defaultModel: 'claude-sonnet'
    }
    expect(resolveComposerModel(settings, { providerId: 'p2', model: 'qwen' })).toEqual({
      providerId: 'p2',
      providerName: 'Local',
      model: 'qwen',
      models: ['qwen']
    })
  })

  it('falls back to the saved default provider and model', () => {
    const settings = {
      providers: [provider({ id: 'first' }), provider({ id: 'p2', models: ['o4-mini'] })],
      defaultProviderId: 'p2',
      defaultModel: 'o4-mini'
    }
    expect(resolveComposerModel(settings)).toMatchObject({
      providerId: 'p2',
      model: 'o4-mini'
    })
  })

  it('falls back to the first usable provider and model', () => {
    const settings = {
      providers: [provider({ id: 'off', enabled: false }), provider({ id: 'p2', models: ['a', 'b'] })]
    }
    expect(resolveComposerModel(settings)).toMatchObject({
      providerId: 'p2',
      providerName: 'Anthropic',
      model: 'a'
    })
  })

  it('ignores a preferred provider that is unavailable', () => {
    const settings = {
      providers: [provider({ id: 'p1' }), provider({ id: 'off', enabled: false, models: ['x'] })],
      defaultProviderId: 'p1'
    }
    expect(resolveComposerModel(settings, { providerId: 'off', model: 'x' })).toMatchObject({
      providerId: 'p1',
      model: 'claude-sonnet'
    })
  })

  it('reports an empty selection when nothing is configured', () => {
    const empty = resolveComposerModel({ providers: [] })
    expect(empty).toEqual({ providerId: '', providerName: '', model: '', models: [] })
    expect(composerModelLabel(empty)).toBe('Choose a model')
    expect(
      composerModelLabel(resolveComposerModel({ providers: [provider()] }))
    ).toBe('claude-sonnet')
  })
})
