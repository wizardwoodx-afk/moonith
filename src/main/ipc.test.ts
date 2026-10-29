/**
 * The knowledge-forge decision doors registered by `src/main/ipc.ts`.
 *
 * A distilled document becomes a skill ONLY through `knowledge:decide`, so the
 * promise under test is the whole of the gate:
 *
 *   - `knowledge:list` reports the stored rows and decides nothing itself;
 *   - an approval mirrors into the shared skill memory exactly once, through
 *     the governed RECOURSE write the service performs per approved row;
 *   - a second decision on the same proposal is refused and mirrors nothing;
 *   - a discard records the human's answer and mirrors nothing;
 *   - an id that is not a knowledge proposal id (a store key, a path, an empty
 *     string, a non-string) is refused in this process before the service sees
 *     it, so the renderer can never name a store key or a path;
 *   - the actor is this process's own local identity, never a renderer string;
 *   - a call from a frame that is not the app's main frame throws.
 *
 * Only Electron, the window getter, the runtime audit and the enterprise
 * control gate are mocked: the proposal service, the skill store, the ledger's
 * governed write matrix and the handlers themselves are the shipped code, and
 * both stores run on one injected localStorage so every assertion reads real
 * rows.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: {
    getPath: vi.fn(() => ''),
    getVersion: vi.fn(() => '0.0.0'),
    getName: vi.fn(() => 'SelfImpulse'),
    isPackaged: false
  },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
  Notification: { isSupported: vi.fn(() => false) },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  webUtils: { getPathForFile: vi.fn() }
}))

vi.mock('./window', () => ({
  applyTitleBarTheme: vi.fn(),
  getMainWindow: vi.fn(() => windowStub)
}))

vi.mock('./audit/runtime', () => ({
  runtimeAudit: {
    record: vi.fn(async () => undefined),
    status: vi.fn(),
    entries: vi.fn(),
    events: vi.fn(),
    flush: vi.fn()
  }
}))

vi.mock('./enterpriseControl/runtime', () => ({
  requireLocalEnterprise: vi.fn(async () => undefined),
  authorizeMissionTeam: vi.fn(async () => []),
  authorizeNativeTaskTool: vi.fn(async () => ({ allowed: true })),
  enterpriseControl: vi.fn()
}))

import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { LOCAL_OWNER_PRINCIPAL_ID } from '@shared/enterpriseControl'
import type {
  KnowledgeDecideResult,
  KnowledgeProposalView
} from '@shared/types'
import { registerIpc } from './ipc'
import { canWrite } from './selfimpulse/mission/ledger'
import { requireLocalEnterprise } from './enterpriseControl/runtime'
import { loadSkills } from './selfimpulse/mission/skillEvolution'
import {
  decideKnowledgeProposal,
  loadKnowledgeProposals,
  proposeKnowledgeSkill,
  saveKnowledgeProposals,
  type KnowledgeProposal
} from './selfimpulse/mission/knowledgeSkills'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown

const handlers = new Map<string, Handler>()

/** The app's own main frame, the way `ipcTrust` compares it. */
const frameStub = { url: 'file:///app/index.html' }
const windowStub = {
  webContents: { mainFrame: frameStub, getURL: () => frameStub.url }
}
const trusted = { senderFrame: frameStub }
const untrusted = { senderFrame: { url: 'file:///elsewhere/index.html' } }

/** One injected storage stands under both `vh.knowledgeSkills.v1` and `vh.skills.v1`. */
const rows = new Map<string, string>()
globalThis.localStorage = {
  getItem: (key: string) => rows.get(key) ?? null,
  setItem: (key: string, value: string) => {
    rows.set(key, value)
  },
  removeItem: (key: string) => {
    rows.delete(key)
  }
} as unknown as Storage

const DOCUMENT = (title: string): string =>
  `# ${title} framework\n\n` +
  `- Never mirror a distilled document into a skill before the human has read its provenance line.\n` +
  `- When a chapter states a rule, carry the rule verbatim instead of summarising it away.\n` +
  `- Only a verified mission may claim a measured effect; knowledge claims none.\n`

const list = (): KnowledgeProposalView[] =>
  handlers.get(IPC.knowledgeList)?.(trusted) as unknown as KnowledgeProposalView[]

const decide = (
  input: Record<string, unknown>,
  event: unknown = trusted
): Promise<KnowledgeDecideResult> =>
  handlers.get(IPC.knowledgeDecide)?.(event, input) as Promise<KnowledgeDecideResult>

let seeded: { a: KnowledgeProposal; b: KnowledgeProposal }

beforeAll(() => {
  vi.mocked(ipcMain.handle).mockImplementation(((channel: string, listener: Handler) => {
    handlers.set(channel, listener)
  }) as typeof ipcMain.handle)
  registerIpc()
})

beforeEach(async () => {
  rows.clear()
  vi.mocked(requireLocalEnterprise).mockClear()
  vi.mocked(requireLocalEnterprise).mockResolvedValue(undefined)
  const first = await proposeKnowledgeSkill({ content: DOCUMENT('Failure modes'), sourceName: 'Runbook' })
  const second = await proposeKnowledgeSkill({ content: DOCUMENT('Trade studies'), sourceName: 'Notebook' })
  if (!first.ok) throw new Error(`the forge under test refused the first seed: ${first.error}`)
  if (!second.ok) throw new Error(`the forge under test refused the second seed: ${second.error}`)
  seeded = { a: first.proposal, b: second.proposal }
})

describe('knowledge:list', () => {
  it('is registered and reports the stored proposals with their provenance', () => {
    expect(handlers.get(IPC.knowledgeList)).toBeTypeOf('function')

    const views = list()

    expect(views).toHaveLength(2)
    const runbook = views.find((view) => view.sourceName === 'Runbook')
    expect(runbook).toBeTruthy()
    expect(runbook?.id).toMatch(/^kn-/)
    expect(runbook?.status).toBe('proposed')
    expect(runbook?.dataHandling).toBe('local')
    expect(runbook?.endpointClass).toBeNull()
    expect(runbook?.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(runbook?.byteLength).toBeGreaterThan(60)
    expect(runbook?.title).toBe('Runbook')
    expect(runbook?.summary).toContain('Failure modes')
  })

  it('never decides anything on its own', () => {
    list()
    list()

    expect(loadKnowledgeProposals().every((proposal) => proposal.status === 'proposed')).toBe(true)
    expect(loadSkills()).toHaveLength(0)
  })

  it('keeps the document body and the internal distiller name out of the view', () => {
    const [one] = list()
    expect(one).not.toHaveProperty('procedure')
    expect(one).not.toHaveProperty('note')
    expect(one).not.toHaveProperty('tool')
    expect(JSON.stringify(list())).not.toContain('mechanical-v1')
  })
})

describe('knowledge:decide — approve', () => {
  it('mirrors the approved proposal into the skill memory exactly once, under a governed human write', async () => {
    const id = seeded.a.id

    const result = await decide({ id, decision: 'approve' })

    expect(result.ok).toBe(true)
    expect(result.error).toBeNull()
    expect(result.proposals.find((proposal) => proposal.id === id)?.status).toBe('approved')
    expect(result.proposals.find((proposal) => proposal.id === id)?.decidedBy).toBe(
      LOCAL_OWNER_PRINCIPAL_ID
    )

    const skills = loadSkills()
    expect(skills).toHaveLength(1)
    expect(skills[0].source).toBe('knowledge')
    expect(skills[0].status).toBe('approved')
    expect(skills[0].description).toMatch(/^\[knowledge\]/)
    /** The governed write the service performs per approved row is the shipped
     *  matrix, not a stub: `saveSkills` runs `enforceWrite("RECOURSE", "human")`
     *  before the row lands, so the row above is evidence the check passed — and
     *  these two lines are the check itself, read from the live module. */
    expect(canWrite('RECOURSE', 'human').ok).toBe(true)
    expect(canWrite('RECOURSE', 'agent').ok).toBe(false)
    expect(requireLocalEnterprise).toHaveBeenCalledWith('approval.decide', 'approval', id)
  })

  it('refuses a second decision on the same proposal and mirrors nothing further', async () => {
    await decide({ id: seeded.a.id, decision: 'approve' })

    const again = await decide({ id: seeded.a.id, decision: 'approve' })

    expect(again.ok).toBe(false)
    expect(again.error).toContain('one decision per proposal')
    expect(loadSkills()).toHaveLength(1)
  })

  it('ignores an actor named by the renderer', async () => {
    const result = await decide({ id: seeded.a.id, decision: 'approve', by: 'someone-else' })

    expect(result.proposals.find((proposal) => proposal.id === seeded.a.id)?.decidedBy).toBe(
      LOCAL_OWNER_PRINCIPAL_ID
    )
    expect(JSON.stringify(result)).not.toContain('someone-else')
  })

  it('lets the control gate refuse the write', async () => {
    vi.mocked(requireLocalEnterprise).mockRejectedValueOnce(
      new Error('Enterprise Control Plane refused approval.decide: a restriction')
    )

    await expect(decide({ id: seeded.a.id, decision: 'approve' })).rejects.toThrow(
      /Enterprise Control Plane refused/
    )

    expect(loadSkills()).toHaveLength(0)
    expect(loadKnowledgeProposals().find((proposal) => proposal.id === seeded.a.id)?.status).toBe(
      'proposed'
    )
  })
})

describe('knowledge:decide — discard', () => {
  it('records the refusal and mirrors nothing', async () => {
    const result = await decide({ id: seeded.b.id, decision: 'discard' })

    expect(result.ok).toBe(true)
    expect(result.proposals.find((proposal) => proposal.id === seeded.b.id)?.status).toBe('discarded')
    expect(result.proposals.find((proposal) => proposal.id === seeded.a.id)?.status).toBe('proposed')
    expect(loadSkills()).toHaveLength(0)
  })

  it('takes the proposal out of the pending set the pane lists', async () => {
    await decide({ id: seeded.b.id, decision: 'discard' })

    expect(list().filter((proposal) => proposal.status === 'proposed').map((p) => p.id)).toEqual([
      seeded.a.id
    ])
  })
})

describe('knowledge:decide — input refused before the service', () => {
  const badIds = ['vh.skills.v1', 'vh.knowledgeSkills.v1', '../../etc/passwd', 'kn-../skills', 'kn-', '', '   ']

  it.each(badIds)('refuses the id %j without touching either store', async (id) => {
    const result = await decide({ id, decision: 'approve' })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('That is not a knowledge proposal. Nothing was decided.')
    expect(loadSkills()).toHaveLength(0)
    expect(loadKnowledgeProposals().every((proposal) => proposal.status === 'proposed')).toBe(true)
  })

  it('refuses a missing id and a non-string id', async () => {
    for (const id of [undefined, null, 42, {}]) {
      const result = await decide({ id, decision: 'approve' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('That is not a knowledge proposal. Nothing was decided.')
    }
    expect(loadSkills()).toHaveLength(0)
  })

  it('refuses a decision that is neither approve nor discard, including an always-approve', async () => {
    for (const decision of ['always_approve', 'APPROVED', undefined, 'auto']) {
      const result = await decide({ id: seeded.a.id, decision })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Choose approve or discard. Nothing was decided.')
    }
    expect(loadSkills()).toHaveLength(0)
    expect(list().find((proposal) => proposal.id === seeded.a.id)?.status).toBe('proposed')
  })

  it('refuses a well-formed id no proposal carries, and returns the honest list', async () => {
    const result = await decide({ id: 'kn-knw-deadbeef00', decision: 'approve' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('no knowledge proposal matches')
    expect(result.proposals).toHaveLength(2)
    expect(loadSkills()).toHaveLength(0)
  })

  it('throws on a sender that is not the app main frame', async () => {
    await expect(decide({ id: seeded.a.id, decision: 'approve' }, untrusted)).rejects.toThrow(
      /Untrusted IPC sender/
    )
    expect(loadSkills()).toHaveLength(0)
  })
})

describe('knowledge:decide — the store and the gate together', () => {
  it('reports an unreadable store as no proposals rather than a promise', () => {
    rows.set('vh.knowledgeSkills.v1', 'not-an-array')
    expect(list()).toEqual([])
  })

  it('refuses a row the renderer planted under a store-key id', async () => {
    const planted: KnowledgeProposal = { ...seeded.a, id: 'vh.skills.v1' }
    const saved = saveKnowledgeProposals([planted])
    expect(saved.ok).toBe(true)

    const result = await decide({ id: 'vh.skills.v1', decision: 'approve' })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('That is not a knowledge proposal. Nothing was decided.')
    expect(loadSkills()).toHaveLength(0)
  })

  it('is refused by the service itself when a decision is asked for outside the gate', () => {
    const outside = decideKnowledgeProposal({
      id: 'vh.skills.v1',
      decision: 'APPROVED',
      by: LOCAL_OWNER_PRINCIPAL_ID
    })

    expect(outside.ok).toBe(false)
    if (outside.ok) throw new Error('the service mirrored a row the store does not hold')
    expect(outside.error).toContain('no knowledge proposal matches')
    expect(loadSkills()).toHaveLength(0)
  })
})
