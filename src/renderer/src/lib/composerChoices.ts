import type { PermissionMode, ProviderPublic, PublicSettings } from '@shared/types'

export interface PermissionChoice {
  value: PermissionMode
  label: string
  blurb: string
}

export const PERMISSION_CHOICES: PermissionChoice[] = [
  {
    value: 'manual',
    label: 'Manual',
    blurb: 'Knight asks before actions that change files or run commands.'
  },
  {
    value: 'auto',
    label: 'Auto',
    blurb: 'Routine work runs freely. High-risk actions still ask first.'
  },
  {
    value: 'skip',
    label: 'Integrated acceptance',
    blurb: 'Accepts every step in this task without asking. Use only in folders you trust.'
  }
]

export function permissionChoice(mode: PermissionMode): PermissionChoice {
  return PERMISSION_CHOICES.find((item) => item.value === mode) ?? PERMISSION_CHOICES[0]
}

type ProviderSettings = Pick<PublicSettings, 'providers'> &
  Partial<Pick<PublicSettings, 'defaultProviderId' | 'defaultModel'>>

export function usableProviders(settings: ProviderSettings | null | undefined): ProviderPublic[] {
  return (settings?.providers ?? []).filter(
    (provider) => provider.enabled && provider.models.length > 0
  )
}

export interface ComposerModelState {
  providerId: string
  providerName: string
  model: string
  models: string[]
}

const EMPTY_MODEL: ComposerModelState = {
  providerId: '',
  providerName: '',
  model: '',
  models: []
}

export function resolveComposerModel(
  settings: ProviderSettings | null | undefined,
  preferred?: { providerId?: string; model?: string }
): ComposerModelState {
  const providers = usableProviders(settings)
  if (!providers.length) return EMPTY_MODEL

  const preferredProvider = providers.find((item) => item.id === preferred?.providerId)
  const provider =
    preferredProvider ??
    providers.find((item) => item.id === settings?.defaultProviderId) ??
    providers[0]

  const preferredModel =
    preferred?.model && (!preferred.providerId || preferredProvider) ? preferred.model : undefined
  const savedDefault =
    provider.id === settings?.defaultProviderId ? settings?.defaultModel : undefined
  const model = preferredModel || savedDefault || provider.models[0] || ''

  return {
    providerId: provider.id,
    providerName: provider.name,
    model,
    models: provider.models
  }
}

export function composerModelLabel(state: ComposerModelState): string {
  return state.model || 'Choose a model'
}
