/**
 * Nomos — the barrel, and the production wiring.
 *
 * `nomosGate()` hands out the one gate the app runs on. It is built lazily
 * so importing this module never touches the filesystem or Electron: probes
 * and unit tests construct a `GovernanceGate` directly with in-memory
 * parts, and only the running app gets the file-backed journal, the
 * persisted kill switch and the registered identities.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getPaths } from '../paths'
import { GovernanceGate } from './gate'
import { GovernanceJournal } from './journal'
import { IdentityRegistry } from './identity'
import { KillSwitch, type KillSwitchState, type KillSwitchStore } from './kill'
import { TrustEngine } from './trust'
import { ALL_CAPABILITIES, type Capability } from './types'

export * from './types'
export { GovernanceGate } from './gate'
export {
  GovernanceJournal,
  JOURNAL_ZERO_HASH,
  type JournalLine,
  type JournalVerifyResult
} from './journal'
export { IdentityRegistry, narrowScopes, capabilitiesForTools } from './identity'
export { KillSwitch, memoryKillSwitchStore, type KillSwitchState, type KillSwitchStore } from './kill'
export { TrustEngine, TRUST_FLOOR, bandFor, type TrustBand, type TrustView } from './trust'
export {
  CAPABILITY_BY_TOOL,
  capabilityForTool,
  evaluatePolicy,
  DEFAULT_RULES,
  killSwitchRule,
  identityRule,
  capabilityRule,
  highRiskRule,
  alwaysApprovalRule,
  policyApprovalRule,
  type PolicyRule,
  type PolicyVerdict
} from './policy'

/** The local owner every agent acts for in a single-user install. */
export const LOCAL_PRINCIPAL_ID = 'local-user'
export const LOCAL_PRINCIPAL_NAME = 'The local owner'

/** The top-level agent. Holds every capability; delegated seats are narrowings
 *  of this set and can never exceed it. */
export const CAPTAIN_AGENT_ID = 'Captain'
export const CAPTAIN_AGENT_NAME = 'Captain'

/** Prefix for delegated Crew seats.
 *
 *  COLLISION-SAFE BY CONSTRUCTION. Normalisation alone is lossy: "Docs Scout",
 *  "docs_scout" and "Docs-Scout" all slug to `docs-scout`, and a shared id
 *  lets one seat silently inherit the other's scopes and trust. The slug
 *  keeps the id readable; a short digest of the exact name makes distinct
 *  names distinct ids, while the same name always maps to the same seat (so
 *  re-delegation replaces its identity instead of spawning a new one). */
export function crewAgentId(name: string): string {
  const trimmed = name.trim()
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'seat'
  const discriminator = createHash('sha256').update(trimmed, 'utf8').digest('hex').slice(0, 8)
  return `crew:${slug}-${discriminator}`
}

function fileKillSwitchStore(file: string): KillSwitchStore {
  return {
    load(): KillSwitchState | null {
      try {
        if (!existsSync(file)) return null
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as KillSwitchState
        return typeof parsed?.engaged === 'boolean' ? parsed : null
      } catch {
        return null
      }
    },
    save(state: KillSwitchState): void {
      try {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, JSON.stringify(state), 'utf8')
      } catch {
        /* A kill switch that cannot persist still engages for this session;
         * losing it on restart is a degraded mode, not a silent one. */
      }
    }
  }
}

/** Build the gate the app runs on, rooted at a profile directory. */
export function createProductionGate(root: string): GovernanceGate {
  const identities = new IdentityRegistry()
  identities.registerPrincipal({
    id: LOCAL_PRINCIPAL_ID,
    kind: 'user',
    displayName: LOCAL_PRINCIPAL_NAME,
    createdAt: new Date().toISOString()
  })
  identities.registerAgent({
    agentId: CAPTAIN_AGENT_ID,
    principalId: LOCAL_PRINCIPAL_ID,
    displayName: CAPTAIN_AGENT_NAME,
    scopes: [...ALL_CAPABILITIES] as Capability[]
  })
  return new GovernanceGate({
    identities,
    trust: new TrustEngine(),
    kill: new KillSwitch(fileKillSwitchStore(join(root, 'nomos', 'kill.json'))),
    journal: new GovernanceJournal(join(root, 'nomos', 'governance.jsonl'))
  })
}

let singleton: GovernanceGate | null = null

/** The one gate. Built on first use, rooted at the app profile. */
export function nomosGate(): GovernanceGate {
  if (!singleton) {
    singleton = createProductionGate(getPaths().root)
  }
  return singleton
}

/** Probe/test helper: replace the singleton. */
export function setNomosGate(gate: GovernanceGate | null): void {
  singleton = gate
}
