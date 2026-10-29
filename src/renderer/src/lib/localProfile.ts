import { useSyncExternalStore } from 'react'
import { DEFAULT_AGENT_NAME } from '@shared/identity'

export { DEFAULT_AGENT_NAME }

export interface LocalProfile {
  name: string
  role: string
  email: string
  /**
   * What this person calls their agent. Empty means they have not chosen yet,
   * which is a real state and not a missing value: it is what the naming
   * reminder waits on. `agentName()` resolves the fallback so no call site has
   * to know the difference.
   */
  agentName: string
}

const KEY = 'selfimpulse.local-profile'
const LEGACY_KEY = 'knight.local-profile'

const DEFAULT_PROFILE: LocalProfile = {
  name: 'You',
  role: 'Owner',
  email: 'This device',
  agentName: ''
}

let cached: LocalProfile = read()
const listeners = new Set<() => void>()

export function hasLocalProfile(): boolean {
  try {
    const raw = window.localStorage.getItem(KEY) ?? window.localStorage.getItem(LEGACY_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as Partial<LocalProfile>
    return Boolean(parsed.name && parsed.name.trim() !== '' && parsed.name.trim() !== 'You')
  } catch {
    return false
  }
}

function read(): LocalProfile {
  try {
    const raw = window.localStorage.getItem(KEY) ?? window.localStorage.getItem(LEGACY_KEY)
    if (!raw) return DEFAULT_PROFILE
    const parsed = JSON.parse(raw) as Partial<LocalProfile>
    return {
      name: parsed.name?.trim() || DEFAULT_PROFILE.name,
      role: parsed.role?.trim() || DEFAULT_PROFILE.role,
      email: parsed.email?.trim() || DEFAULT_PROFILE.email,
      agentName: parsed.agentName?.trim() ?? ''
    }
  } catch {
    return DEFAULT_PROFILE
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getLocalProfile(): LocalProfile {
  return cached
}

export function saveLocalProfile(patch: Partial<LocalProfile>): LocalProfile {
  cached = {
    name: (patch.name ?? cached.name).trim() || DEFAULT_PROFILE.name,
    role: (patch.role ?? cached.role).trim() || DEFAULT_PROFILE.role,
    email: (patch.email ?? cached.email).trim() || DEFAULT_PROFILE.email,
    // Unlike the person's own name, an empty agent name is meaningful: it is
    // "not chosen yet", so it must not be coerced back to a default here.
    agentName: (patch.agentName ?? cached.agentName).trim().slice(0, 24)
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cached))
  } catch {
    // A read-only profile store should not take the app down.
  }
  emit()
  return cached
}

/** The resolved name to show or say. Never empty. */
export function agentName(profile: LocalProfile = cached): string {
  return profile.agentName.trim() || DEFAULT_AGENT_NAME
}

/** True once the person has named their agent themselves. */
export function hasNamedAgent(profile: LocalProfile = cached): boolean {
  return profile.agentName.trim().length > 0
}

export function profileInitial(profile: LocalProfile): string {
  return (profile.name.trim()[0] ?? 'Y').toUpperCase()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return
    cached = read()
    emit()
  })
}

export function useLocalProfile(): LocalProfile {
  return useSyncExternalStore(subscribe, getLocalProfile, getLocalProfile)
}

/** Reactive resolved agent name — re-renders the moment it is renamed. */
export function useAgentName(): string {
  return agentName(useLocalProfile())
}
