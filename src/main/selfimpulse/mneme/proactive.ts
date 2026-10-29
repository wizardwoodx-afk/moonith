/**
 * Kubernis: Proactive Background Coworker Engine for SelfImpulse.
 *
 * Named from Greek "Κυβέρνησις" (steering / proactive direction).
 * Inspired by Rowboat's background event-driven triggers: instead of passively
 * waiting for a user prompt, Kubernis inspects local workspace state, missing tests,
 * undocumented modules, and recent changes to provide actionable proactive insights.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { newId, nowIso } from '../../util'
import type { KubernisInsight } from '@shared/types'
import { mnemeGraph } from './graph'

export class KubernisProactiveEngine {
  private insights: KubernisInsight[] = []

  async analyzeWorkspace(workspacePath: string): Promise<KubernisInsight[]> {
    const list: KubernisInsight[] = []

    try {
      // 1. Sync knowledge graph
      const summary = await mnemeGraph.indexDirectory(workspacePath)

      // 2. Proactive Rule: Check if project has documentation
      if (summary.nodeCount === 0) {
        list.push({
          id: newId('ins'),
          title: 'Missing Project Documentation',
          description: 'No Markdown architecture or documentation files were detected in the workspace.',
          severity: 'suggestion',
          suggestedAction: 'Generate an initial architecture spec using the Mneme Knowledge Graph.',
          timestamp: nowIso()
        })
      } else {
        // Check for isolated / unlinked nodes
        const isolated = summary.nodes.filter((n) => n.links.length === 0)
        if (isolated.length > 2) {
          list.push({
            id: newId('ins'),
            title: 'Unlinked Knowledge Nodes',
            description: `${isolated.length} documentation nodes have no WikiLink connections (e.g. ${isolated[0].title}).`,
            severity: 'info',
            suggestedAction: 'Cross-reference related topics using [[TopicName]] WikiLinks.',
            timestamp: nowIso()
          })
        }
      }

      // 3. Proactive Rule: Check for package.json or project config
      try {
        const pkgRaw = await fs.readFile(join(workspacePath, 'package.json'), 'utf8')
        const pkg = JSON.parse(pkgRaw)

        if (!pkg.scripts?.test) {
          list.push({
            id: newId('ins'),
            title: 'No Test Script Defined',
            description: 'package.json lacks an automated "test" script.',
            severity: 'warning',
            suggestedAction: 'Add a test script (e.g. vitest, jest) to ensure test-driven verification.',
            sourceFile: 'package.json',
            timestamp: nowIso()
          })
        }
      } catch {
        // Not a node project, skip
      }
    } catch {
      // Graceful fallback
    }

    this.insights = list
    return list
  }

  getRecentInsights(): KubernisInsight[] {
    return [...this.insights]
  }

  clearInsights(): void {
    this.insights = []
  }
}

export const kubernisEngine = new KubernisProactiveEngine()
