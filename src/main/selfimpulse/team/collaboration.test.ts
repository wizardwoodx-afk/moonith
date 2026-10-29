import { describe, expect, it } from 'vitest'
import { permissionMatrix } from './permissions'
import { layeredMemory } from './layeredMemory'
import { crdtContext } from './crdtContext'
import { collaborativeTaskBoard } from './taskBoard'

describe('Multi-User Collaboration Engine', () => {
  it('enforces two separate permission axes (workspace vs agent execution)', () => {
    // Teammate is a workspace editor, but only allowed to execute 'kubernis' (not 'daedalus')
    permissionMatrix.setUserPermission({
      userId: 'user_bob',
      userName: 'Bob Designer',
      workspaceRole: 'editor',
      agentRights: {
        kubernis: 'execute',
        daedalus: 'none'
      }
    })

    expect(permissionMatrix.canExecuteAgent('user_bob', 'kubernis')).toBe(true)
    expect(permissionMatrix.canExecuteAgent('user_bob', 'daedalus')).toBe(false)

    // Workspace viewer can never execute any agent
    permissionMatrix.setUserPermission({
      userId: 'user_carol',
      userName: 'Carol Stakeholder',
      workspaceRole: 'viewer',
      agentRights: {
        kubernis: 'execute'
      }
    })
    expect(permissionMatrix.canExecuteAgent('user_carol', 'kubernis')).toBe(false)
  })

  it('manages layered memory (private scratchpad vs shared team memory)', () => {
    layeredMemory.setPrivate('daedalus', 'current_file', 'src/engine.ts')
    expect(layeredMemory.getPrivate('daedalus', 'current_file')).toBe('src/engine.ts')
    expect(layeredMemory.getPrivate('kubernis', 'current_file')).toBeNull()

    layeredMemory.setShared('daedalus', 'api_convention', 'RESTful camelCase')
    expect(layeredMemory.getShared('api_convention')).toBe('RESTful camelCase')

    const daedalusContext = layeredMemory.getMergedContext('daedalus')
    expect(daedalusContext['api_convention']).toBe('RESTful camelCase')
    expect(daedalusContext['private:current_file']).toBe('src/engine.ts')
  })

  it('handles conflict-safe shared context with CRDT LWW and Lamport timestamps', () => {
    crdtContext.allowPeer('peer_b')

    const localEntry = crdtContext.set('table_goal', 'Ship v1.0', 'local')
    expect(crdtContext.get('table_goal')).toBe('Ship v1.0')

    // Peer B sends a concurrent update with higher Lamport timestamp
    const applied = crdtContext.mergeRemote({
      key: 'table_goal',
      value: 'Ship v1.1 with Sandbox',
      peerId: 'peer_b',
      lamportTimestamp: localEntry.lamportTimestamp + 1,
      wallClock: new Date().toISOString()
    })

    expect(applied).toBe(true)
    expect(crdtContext.get('table_goal')).toBe('Ship v1.1 with Sandbox')
  })

  it('tracks collaborative task board handoffs carrying the reasoning trail', () => {
    const task = collaborativeTaskBoard.createTask({
      title: 'Harden Sandbox',
      description: 'Implement realpath barrier',
      creatorId: 'Alice',
      assigneeAgentId: 'daedalus'
    })

    expect(task.status).toBe('backlog')

    const handedOff = collaborativeTaskBoard.handoffTask({
      taskId: task.id,
      fromAgentId: 'daedalus',
      toAgentId: 'kubernis',
      reasoningSummary: 'Completed core realpath check; passing to watcher for audit.',
      hypothesesTested: ['Windows drive letter canonicalization', 'Symlink breakout'],
      tradeoffsEvaluated: ['Strict realpath throws on non-existent path vs lexical check'],
      newStatus: 'review'
    })

    expect(handedOff.status).toBe('review')
    expect(handedOff.assigneeAgentId).toBe('kubernis')
    expect(handedOff.handoffHistory.length).toBe(1)
    expect(handedOff.handoffHistory[0].reasoningSummary).toContain('Completed core realpath check')
  })
})
