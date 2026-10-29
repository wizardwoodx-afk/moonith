import { describe, expect, it } from 'vitest'
import {
  buildSecurityPosture,
  type SecurityPostureInput
} from './posture'

function input(overrides: Partial<SecurityPostureInput> = {}): SecurityPostureInput {
  return {
    keychainAvailable: true,
    sealedSecrets: 1,
    plaintextSecrets: 0,
    providerCount: 1,
    serverCount: 0,
    channelCount: 0,
    allowShell: false,
    permissionMode: 'manual',
    ...overrides
  }
}

function item(posture: ReturnType<typeof buildSecurityPosture>, id: string) {
  const found = posture.items.find((entry) => entry.id === id)
  if (!found) throw new Error(`missing posture item ${id}`)
  return found
}

describe('buildSecurityPosture', () => {
  it('returns well-formed items with a pane and no score', () => {
    const posture = buildSecurityPosture(input())

    expect(posture.items).toHaveLength(5)
    for (const entry of posture.items) {
      expect(entry.id).toBeTruthy()
      expect(entry.label).toBeTruthy()
      expect(entry.detail).toBeTruthy()
      expect(['good', 'attention', 'off']).toContain(entry.state)
      expect(entry.pane).toBeTruthy()
    }
    expect(posture).not.toHaveProperty('score')
    expect(posture.providerCount).toBe(1)
    expect(posture.keychainAvailable).toBe(true)
  })

  it('flags an unavailable keychain', () => {
    const posture = buildSecurityPosture(input({ keychainAvailable: false }))
    expect(item(posture, 'key-storage').state).toBe('attention')
    expect(item(posture, 'key-storage').detail).toMatch(/keychain is unavailable/i)
  })

  it('flags legacy plaintext secrets', () => {
    const posture = buildSecurityPosture(input({ plaintextSecrets: 2 }))
    expect(item(posture, 'key-storage').state).toBe('attention')
    expect(item(posture, 'key-storage').detail).toContain('2')
    expect(item(posture, 'key-storage').detail).toMatch(/unencrypted/i)
  })

  it('calls sealed storage good when the keychain is available and nothing is plaintext', () => {
    const posture = buildSecurityPosture(input())
    expect(item(posture, 'key-storage').state).toBe('good')
    expect(item(posture, 'key-storage').detail).toMatch(/sealed by the OS keychain/i)
  })

  it('marks shell access good only when it is off', () => {
    expect(item(buildSecurityPosture(input({ allowShell: false })), 'shell-access').state).toBe(
      'good'
    )
    const on = item(buildSecurityPosture(input({ allowShell: true })), 'shell-access')
    expect(on.state).toBe('attention')
    expect(on.detail).toMatch(/shell commands/i)
  })

  it('holds plan and manual approvals as good', () => {
    expect(item(buildSecurityPosture(input({ permissionMode: 'plan' })), 'approval-gate').state).toBe(
      'good'
    )
    expect(
      item(buildSecurityPosture(input({ permissionMode: 'manual' })), 'approval-gate').state
    ).toBe('good')
  })

  it('marks auto approvals as attention and skip as off', () => {
    const auto = item(buildSecurityPosture(input({ permissionMode: 'auto' })), 'approval-gate')
    expect(auto.state).toBe('attention')
    expect(auto.detail).toMatch(/without asking/i)

    const skip = item(buildSecurityPosture(input({ permissionMode: 'skip' })), 'approval-gate')
    expect(skip.state).toBe('off')
    expect(skip.detail).toMatch(/full access/i)
    expect(skip.detail).toMatch(/shell/i)
  })

  it('reports tool servers without claiming they are sandboxed', () => {
    const none = item(buildSecurityPosture(input({ serverCount: 0 })), 'tool-servers')
    expect(none.state).toBe('good')
    expect(none.detail).toBe('No tool servers configured.')

    const some = item(buildSecurityPosture(input({ serverCount: 3 })), 'tool-servers')
    expect(some.state).toBe('good')
    expect(some.detail).toContain('3')
    expect(some.detail).not.toMatch(/sandbox/i)
  })

  it('turns saved access off when nothing is sealed', () => {
    const empty = item(buildSecurityPosture(input({ sealedSecrets: 0 })), 'saved-access')
    expect(empty.state).toBe('off')
    expect(empty.detail).toMatch(/no keys saved/i)

    const sealed = item(buildSecurityPosture(input({ sealedSecrets: 2 })), 'saved-access')
    expect(sealed.state).toBe('good')
    expect(sealed.detail).toContain('2')
  })
})
