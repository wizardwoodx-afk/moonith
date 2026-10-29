/**
 * Harmonia: Executive Decision Card Feed for SelfImpulse.
 *
 * Named from Greek "Ἁρμονία" (harmony, agreement, concord).
 * Inspired by Browser-Use's open-duet asynchronous card feed model:
 * Instead of endless chat streaming, background agents finish work, draft code patches,
 * stage media or detect issues, packaging them into actionable Decision Cards.
 * The human executive reviews and decides with one click: Accept, Reject, or Iterate.
 */
import { join } from 'node:path'
import { getPaths } from '../../paths'
import { atomicWriteJson, newId, nowIso, readJson } from '../../util'
import type {
  HarmoniaDecisionCard,
  HarmoniaDecisionInput,
  HarmoniaDecisionStatus
} from '@shared/types'

function getHarmoniaFile(): string {
  try {
    return join(getPaths().root, 'harmonia_cards.json')
  } catch {
    return join(process.cwd(), '.harmonia_cards.json')
  }
}

const SEED_CARDS: HarmoniaDecisionCard[] = [
  {
    cardId: 'card_patch_1',
    agentId: 'daedalus',
    agentName: 'Daedalus Coder',
    title: 'Harden File Upload Directory Traversal Check',
    summary: 'Detected unvalidated subfolder recursion. Implemented realpath canonicalization barrier to confine dropped archives.',
    kind: 'patch',
    diff: `--- a/src/main/agent/runtime.ts\n+++ b/src/main/agent/runtime.ts\n@@ -102,3 +102,6 @@\n+    const canonical = await fs.realpath(dest)\n+    if (!canonical.startsWith(workspaceRoot)) throw new Error('Path escape')`,
    suggestedAction: 'Apply security patch to prevent directory traversal in archive extraction.',
    status: 'pending',
    timestamp: new Date().toISOString()
  },
  {
    cardId: 'card_insight_1',
    agentId: 'kubernis',
    agentName: 'Kubernis Proactive Watcher',
    title: 'Cross-Reference Mneme Architecture Graph',
    summary: 'Discovered 4 unlinked architecture documentation nodes. Prepared bidirectional [[WikiLinks]] for Obsidian compatibility.',
    kind: 'insight',
    suggestedAction: 'Update documentation index with [[Architecture]] and [[Security]] WikiLinks.',
    status: 'pending',
    timestamp: new Date(Date.now() - 3600000).toISOString()
  }
]

export class HarmoniaService {
  private cards: Map<string, HarmoniaDecisionCard> = new Map()
  private loaded = false

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    const file = getHarmoniaFile()
    const stored = await readJson<HarmoniaDecisionCard[]>(file, [])
    if (stored.length === 0) {
      for (const card of SEED_CARDS) {
        this.cards.set(card.cardId, card)
      }
      try {
        await atomicWriteJson(file, SEED_CARDS)
      } catch {
        // Fallback for tests
      }
    } else {
      for (const card of stored) {
        this.cards.set(card.cardId, card)
      }
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    const file = getHarmoniaFile()
    const list = Array.from(this.cards.values())
    await atomicWriteJson(file, list)
  }

  async listCards(status?: HarmoniaDecisionStatus): Promise<HarmoniaDecisionCard[]> {
    await this.ensureLoaded()
    const list = Array.from(this.cards.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    if (!status) return list
    return list.filter((c) => c.status === status)
  }

  async createCard(input: HarmoniaDecisionInput): Promise<HarmoniaDecisionCard> {
    await this.ensureLoaded()
    const cardId = newId('card')
    const card: HarmoniaDecisionCard = {
      cardId,
      agentId: input.agentId,
      agentName: input.agentName,
      title: input.title.trim(),
      summary: input.summary.trim(),
      kind: input.kind,
      diff: input.diff,
      suggestedAction: input.suggestedAction.trim(),
      status: 'pending',
      timestamp: nowIso(),
      metadata: input.metadata
    }

    this.cards.set(cardId, card)
    await this.persist()
    return card
  }

  async decideCard(input: {
    cardId: string
    decision: 'accept' | 'reject'
    comment?: string
  }): Promise<HarmoniaDecisionCard> {
    await this.ensureLoaded()
    const card = this.cards.get(input.cardId)
    if (!card) {
      throw new Error(`Decision card not found: ${input.cardId}`)
    }

    if (input.decision === 'accept') {
      card.status = 'accepted'
    } else {
      card.status = 'rejected'
    }

    if (input.comment) {
      card.metadata = { ...(card.metadata ?? {}), decisionComment: input.comment }
    }

    await this.persist()
    return card
  }

  async dismissCard(cardId: string): Promise<boolean> {
    await this.ensureLoaded()
    const deleted = this.cards.delete(cardId)
    if (deleted) {
      await this.persist()
    }
    return deleted
  }
}

export const harmoniaService = new HarmoniaService()
