import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureNodeStorageRoot, resetNodeStorageForTests } from '../persist/nodeStorage'
import { mainStorage } from '../persist/mainStorage'
import { defaultDurableKV, resetDurableKVDefault } from './durable'
import { loadGatePolicy, saveGatePolicy } from './verifyGate'

let directory = ''

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'selfimpulse-native-durable-'))
  configureNodeStorageRoot(join(directory, 'selfimpulse'))
  resetDurableKVDefault()
  vi.stubGlobal('localStorage', undefined)
})

afterEach(async () => {
  resetDurableKVDefault()
  resetNodeStorageForTests()
  vi.unstubAllGlobals()
  await rm(directory, { recursive: true, force: true })
})

describe('native mission storage', () => {
  it('reloads the shared durable adapter and mission policy after a restart', () => {
    defaultDurableKV().set('vh.durable.native-test', JSON.stringify({ resumed: true }))
    saveGatePolicy('ADVISORY')

    resetDurableKVDefault()
    expect(JSON.parse(defaultDurableKV().get('vh.durable.native-test') ?? '{}')).toEqual({ resumed: true })
    expect(loadGatePolicy()).toBe('ADVISORY')
  })

  it('implements the Storage enumeration contract used by vault upgrades', () => {
    const storage = mainStorage()
    storage.setItem('vh.native.one', '1')
    storage.setItem('vh.native.two', '2')
    expect(storage.length).toBe(2)
    expect([storage.key(0), storage.key(1)]).toEqual(expect.arrayContaining(['vh.native.one', 'vh.native.two']))
    expect(storage.key(2)).toBeNull()
    storage.clear()
    expect(storage.length).toBe(0)
  })
})
