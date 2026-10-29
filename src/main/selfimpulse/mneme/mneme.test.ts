import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mnemeGraph } from './graph'
import { kubernisEngine } from './proactive'

describe('Mneme Knowledge Graph & Kubernis Proactive Watcher', () => {
  let tempDir: string

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mneme-test-'))
  })

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('builds a local-first markdown knowledge graph with WikiLinks and tags', async () => {
    // Create test markdown notes
    const note1 = `# Core Architecture\n\nThe engine connects to [[DatabaseStorage]] and [[AuditLedger]]. #architecture #core`
    const note2 = `# DatabaseStorage\n\nLocal SQLite storage engine. Links to [[AuditLedger]]. #storage`
    const note3 = `# AuditLedger\n\nCryptographic audit log. #security`

    writeFileSync(join(tempDir, 'architecture.md'), note1, 'utf8')
    writeFileSync(join(tempDir, 'database.md'), note2, 'utf8')
    writeFileSync(join(tempDir, 'audit.md'), note3, 'utf8')

    const summary = await mnemeGraph.indexDirectory(tempDir)
    expect(summary.nodeCount).toBe(3)
    expect(summary.linkCount).toBe(3)

    const queryRes = mnemeGraph.query('security')
    expect(queryRes.length).toBeGreaterThanOrEqual(1)
    expect(queryRes[0].title).toBe('AuditLedger')

    const archNode = mnemeGraph.query('Core Architecture')[0]
    expect(archNode.links).toEqual(['DatabaseStorage', 'AuditLedger'])
    expect(archNode.tags).toContain('architecture')
  })

  it('upserts a new knowledge node into the workspace', async () => {
    const node = await mnemeGraph.upsertNode(tempDir, {
      id: 'agent_protocols',
      title: 'Agent Coordination Protocols',
      content: 'Multi-agent delegation and task handoff contracts.',
      tags: ['protocols', 'agents'],
      links: ['Core Architecture']
    })

    expect(node.id).toBe('agent_protocols')
    expect(node.title).toBe('Agent Coordination Protocols')
    expect(node.links).toContain('Core Architecture')

    const summary = mnemeGraph.getSummary()
    expect(summary.nodeCount).toBe(4)
  })

  it('kubernis proactive engine inspects workspace and detects insights', async () => {
    const insights = await kubernisEngine.analyzeWorkspace(tempDir)
    expect(insights).toBeDefined()
    expect(Array.isArray(insights)).toBe(true)
  })
})
