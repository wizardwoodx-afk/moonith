/**
 * Two-Axis Permission Matrix for SelfImpulse Team Collaboration.
 *
 * Enforces two completely separate permission axes:
 * 1. Workspace Access Role: 'viewer' | 'editor' | 'admin'
 * 2. Agent Execution Right: 'execute' | 'delegate' | 'configure' | 'none'
 *
 * Decoupling these prevents critical security vulnerabilities where granting a teammate
 * workspace read access accidentally gives them arbitrary code execution rights over production agents.
 */

export type WorkspaceRole = 'viewer' | 'editor' | 'admin'
export type AgentExecutionRight = 'execute' | 'delegate' | 'configure' | 'none'

export interface TeammatePermission {
  userId: string
  userName: string
  workspaceRole: WorkspaceRole
  agentRights: Record<string, AgentExecutionRight> // per-agentId rights
}

export class PermissionMatrixService {
  private permissions: Map<string, TeammatePermission> = new Map()

  setUserPermission(permission: TeammatePermission): void {
    this.permissions.set(permission.userId, permission)
  }

  getUserPermission(userId: string): TeammatePermission | null {
    return this.permissions.get(userId) ?? null
  }

  /**
   * Check if a teammate has authorization to trigger an agent action.
   */
  canExecuteAgent(userId: string, agentId: string): boolean {
    const perm = this.permissions.get(userId)
    if (!perm) return false

    // Workspace viewer can never execute agents
    if (perm.workspaceRole === 'viewer') return false

    const right = perm.agentRights[agentId] ?? 'none'
    return right === 'execute' || right === 'delegate' || right === 'configure'
  }

  /**
   * Check if a teammate has authorization to reconfigure agent instructions or tools.
   */
  canConfigureAgent(userId: string, agentId: string): boolean {
    const perm = this.permissions.get(userId)
    if (!perm) return false
    if (perm.workspaceRole !== 'admin') return false

    const right = perm.agentRights[agentId] ?? 'none'
    return right === 'configure'
  }
}

export const permissionMatrix = new PermissionMatrixService()
