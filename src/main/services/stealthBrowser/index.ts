/**
 * Unified Stealth Browser Engine
 *
 * Integrates:
 * 1. Camoufox Firefox-based anti-detect & fingerprint synthesis.
 * 2. UI-TARS visual GUI control with normalized 0-1000 coordinate reasoning.
 * 3. Browser Task Controller for hybrid routing (DOM vs. Visual GUI).
 * 4. Always-On Stealth Search Router.
 */

import { camoufoxEngine, CamoufoxEngine } from './camoufoxEngine'
import { uitarsEngine, UITARSEngine } from './uitarsEngine'
import { taskController, BrowserTaskController } from './taskController'
import { stealthSearchRouter, StealthSearchRouter } from './stealthSearchRouter'
import type {
  AutomationMode,
  BrowserPageContext,
  CamoufoxConfig,
  ControllerDecision,
  StealthSearchOutcome,
  UITARSAction,
  UITARSPoint
} from './types'

export * from './types'
export { camoufoxEngine, CamoufoxEngine }
export { uitarsEngine, UITARSEngine }
export { taskController, BrowserTaskController }
export { stealthSearchRouter, StealthSearchRouter }

export class StealthBrowserCore {
  public readonly camoufox = camoufoxEngine
  public readonly uitars = uitarsEngine
  public readonly controller = taskController
  public readonly searchRouter = stealthSearchRouter

  /**
   * Evaluates the active page and decides the optimal execution path (DOM vs UI-TARS Visual).
   */
  public evaluatePath(
    intent: { goal: string; targetHint?: string; actionType?: 'click' | 'type' | 'drag' | 'navigate' | 'extract' },
    context: BrowserPageContext
  ): ControllerDecision {
    return this.controller.decideExecutionPath(intent, context)
  }

  /**
   * Performs an always-on stealth search directly routed through the stealth engine.
   */
  public async search(query: string, limit = 8): Promise<StealthSearchOutcome> {
    return this.searchRouter.search(query, limit)
  }

  /**
   * Prepares human-like mouse curve trajectory for a visual click at a normalized UI-TARS point.
   */
  public prepareVisualInteraction(
    currentScreenPos: { x: number; y: number },
    targetPoint: UITARSPoint,
    viewport: { width: number; height: number }
  ): { targetScreenPos: { x: number; y: number }; curve: ReturnType<typeof camoufoxEngine.generateHumanCurve> } {
    const targetScreenPos = this.uitars.toScreenCoords(targetPoint, viewport)
    const curve = this.camoufox.generateHumanCurve(
      currentScreenPos.x,
      currentScreenPos.y,
      targetScreenPos.x,
      targetScreenPos.y
    )

    return { targetScreenPos, curve }
  }
}

export const stealthBrowser = new StealthBrowserCore()
