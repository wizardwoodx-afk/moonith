import { useSyncExternalStore } from 'react'

export interface LocalProfile {
  name: string
  role: string
  email: string
}

const KEY = 'knight.local-profile'

const DEFAULT_PROFILE: LocalProfile = {
  name: 'Local user',
  role: 'Owner · Self mode',
  email: 'On this device'
}

let cached: LocalProfile = read()
const listeners = new Set<() => void>()

function read(): LocalProfile {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULT_PROFILE
    const parsed = JSON.parse(raw) as Partial<LocalProfile>
    return {
      name: parsed.name?.trim() || DEFAULT_PROFILE.name,
      role: parsed.role?.trim() || DEFAULT_PROFILE.role,
      email: parsed.email?.trim() || DEFAULT_PROFILE.email
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
  return () => listeners.delete(listener)
}

export function getLocalProfile(): LocalProfile {
  return cached
}

export function saveLocalProfile(patch: Partial<LocalProfile>): LocalProfile {
  cached = {
    name: (patch.name ?? cached.name).trim() || DEFAULT_PROFILE.name,
    role: (patch.role ?? cached.role).trim() || DEFAULT_PROFILE.role,
    email: (patch.email ?? cached.email).trim() || DEFAULT_PROFILE.email
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cached))
  } catch {
    // A read-only profile store should not take the app down.
  }
  emit()
  return cached
}

export function profileInitial(profile: LocalProfile): string {
  return (profile.name.trim()[0] ?? 'L').toUpperCase()
}

export function useLocalProfile(): LocalProfile {
  return useSyncExternalStore(subscribe, getLocalProfile, getLocalProfile)
}
