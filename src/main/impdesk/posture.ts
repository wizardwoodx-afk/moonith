/**
 * ImpDesk security posture: a short, honest list of what is true on this
 * machine right now. Every item is derived from settings or the access file;
 * there is no score, and no claim about anything that was not observed.
 */
import { readFile } from 'node:fs/promises'
import type {
  PermissionMode,
  SecurityPosture,
  SecurityPostureItem,
  SecurityPostureState
} from '@shared/types'

export interface SecurityPostureInput {
  keychainAvailable: boolean
  sealedSecrets: number
  plaintextSecrets: number
  providerCount: number
  serverCount: number
  channelCount: number
  allowShell: boolean
  permissionMode: PermissionMode
}

function approvalItem(mode: PermissionMode): SecurityPostureItem {
  if (mode === 'plan') {
    return {
      id: 'approval-gate',
      label: 'Approval gate',
      detail: 'Plan mode: reads and research run; file changes and commands are denied.',
      state: 'good',
      pane: 'permissions'
    }
  }
  if (mode === 'manual') {
    return {
      id: 'approval-gate',
      label: 'Approval gate',
      detail: 'Manual mode: file changes and commands wait for your approval.',
      state: 'good',
      pane: 'permissions'
    }
  }
  if (mode === 'auto') {
    return {
      id: 'approval-gate',
      label: 'Approval gate',
      detail: 'Auto mode: routine work runs without asking; risky actions still need approval.',
      state: 'attention',
      pane: 'permissions'
    }
  }
  return {
    id: 'approval-gate',
    label: 'Approval gate',
    detail: 'Full access: steps run without asking; shell and high-risk actions still need approval.',
    state: 'off',
    pane: 'permissions'
  }
}

function keyStorageItem(input: SecurityPostureInput): SecurityPostureItem {
  let state: SecurityPostureState = 'good'
  let detail = 'Every saved key is sealed by the OS keychain.'
  if (!input.keychainAvailable) {
    state = 'attention'
    detail = 'The OS keychain is unavailable; keys cannot be sealed.'
  } else if (input.plaintextSecrets > 0) {
    state = 'attention'
    detail = `${input.plaintextSecrets} legacy secret(s) are still stored unencrypted.`
  }
  return { id: 'key-storage', label: 'Key storage', detail, state, pane: 'providers' }
}

/**
 * Pure: everything the cockpit shows comes from this function, so tests can
 * cover each state without touching Electron, the keychain, or the disk.
 */
export function buildSecurityPosture(input: SecurityPostureInput): SecurityPosture {
  const items: SecurityPostureItem[] = [
    keyStorageItem(input),
    {
      id: 'shell-access',
      label: 'Shell access',
      detail: input.allowShell
        ? 'The agent can run shell commands under the approval gate.'
        : 'Shell commands are off.',
      state: input.allowShell ? 'attention' : 'good',
      pane: 'permissions'
    },
    approvalItem(input.permissionMode),
    {
      id: 'tool-servers',
      label: 'Tool servers',
      detail:
        input.serverCount === 0
          ? 'No tool servers configured.'
          : `${input.serverCount} ${
              input.serverCount === 1 ? 'tool server' : 'tool servers'
            } configured; each can expose tools to the agent.`,
      state: 'good',
      pane: 'mcp'
    },
    {
      id: 'saved-access',
      label: 'Saved keys',
      detail:
        input.sealedSecrets > 0
          ? input.keychainAvailable
            ? `${input.sealedSecrets} saved ${
                input.sealedSecrets === 1 ? 'key is' : 'keys are'
              } sealed by the OS keychain.`
            : `${input.sealedSecrets} saved ${
                input.sealedSecrets === 1 ? 'key exists' : 'keys exist'
              }; the OS keychain is unavailable right now.`
          : 'No keys saved yet.',
      state:
        input.sealedSecrets > 0 ? (input.keychainAvailable ? 'good' : 'attention') : 'off',
      pane: 'providers'
    }
  ]

  return {
    items,
    sealedSecrets: input.sealedSecrets,
    plaintextSecrets: input.plaintextSecrets,
    providerCount: input.providerCount,
    serverCount: input.serverCount,
    channelCount: input.channelCount,
    keychainAvailable: input.keychainAvailable
  }
}

/** Legacy `plain:` secrets in the raw settings file, counted from disk. */
async function countPlaintextSecrets(settingsFile: string): Promise<number> {
  try {
    const raw = await readFile(settingsFile, 'utf8')
    return raw.match(/"plain:/g)?.length ?? 0
  } catch {
    return 0
  }
}

/** What the cockpit reads. Lazy imports keep the pure builder Electron-free. */
export async function getSecurityPosture(): Promise<SecurityPosture> {
  const [{ safeStorage }, { store }, { getPaths }] = await Promise.all([
    import('electron'),
    import('../store'),
    import('../paths')
  ])

  let keychainAvailable = false
  try {
    keychainAvailable = safeStorage.isEncryptionAvailable()
  } catch {
    keychainAvailable = false
  }

  const settings = store.getPublicSettings()
  const sealedSecrets =
    settings.providers.filter((provider) => provider.hasKey).length +
    settings.channels.filter((channel) => channel.hasToken).length +
    (settings.connectors.hasKey ? 1 : 0)
  const plaintextSecrets = await countPlaintextSecrets(getPaths().settingsFile)

  return buildSecurityPosture({
    keychainAvailable,
    sealedSecrets,
    plaintextSecrets,
    providerCount: settings.providers.length,
    serverCount: settings.mcpServers.length,
    channelCount: settings.channels.length,
    allowShell: settings.allowShell,
    permissionMode: settings.defaultPermissionMode
  })
}
