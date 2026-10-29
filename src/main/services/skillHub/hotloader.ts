/**
 * Dynamic Skill Hot-Reloader for SelfImpulse.
 *
 * Allows newly installed or updated skills to be immediately recognized by
 * active agent conversations without restarting the application.
 */

type SkillChangeListener = (event: { action: 'installed' | 'uninstalled'; skillId: string }) => void

export class SkillHotReloader {
  private listeners = new Set<SkillChangeListener>()

  subscribe(listener: SkillChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  notifyChange(action: 'installed' | 'uninstalled', skillId: string): void {
    for (const listener of this.listeners) {
      try {
        listener({ action, skillId })
      } catch (err) {
        console.error('[SkillHotReloader] Listener threw error:', err)
      }
    }
  }
}

export const skillHotReloader = new SkillHotReloader()
