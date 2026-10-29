/**
 * Browser Task Controller
 *
 * Chooses between DOM automation (Playwright style) and Visual GUI control (UI-TARS).
 * Manages automatic fallback and hybrid execution.
 */

import type { AutomationMode, BrowserPageContext, ControllerDecision, UITARSAction } from './types'
import { uitarsEngine } from './uitarsEngine'

export interface TaskIntent {
  goal: string
  targetHint?: string
  actionType?: 'click' | 'type' | 'drag' | 'navigate' | 'extract'
}

export class BrowserTaskController {
  /**
   * Decides whether to use DOM automation or Visual GUI control based on the page context and user intent.
   */
  public decideExecutionPath(intent: TaskIntent, context: BrowserPageContext): ControllerDecision {
    // 1. CAPTCHA or Cloudflare Bot Challenge Detection -> Immediate Visual GUI
    if (context.hasCaptcha) {
      return {
        mode: 'visual_gui',
        reason: 'Active CAPTCHA or bot verification challenge detected on page. Requires visual spatial reasoning.',
        confidence: 0.98,
        suggestedAction: {
          type: 'click',
          point: { x: 500, y: 500 },
          thought: 'Locate and solve visual challenge'
        }
      }
    }

    // 2. Heavy Canvas or WebGL App (Figma, Miro, Google Docs/Sheets, Flutter Web)
    if (context.hasCanvas) {
      return {
        mode: 'visual_gui',
        reason: 'Target page relies on HTML5 Canvas / WebGL where DOM tree lacks interactable elements.',
        confidence: 0.92,
        suggestedAction: {
          type: 'click',
          point: { x: 500, y: 500 },
          thought: 'Interact visually on canvas surface'
        }
      }
    }

    // 3. Drag and drop or slider gesture intents
    if (intent.actionType === 'drag') {
      return {
        mode: 'visual_gui',
        reason: 'Continuous spatial drag-and-drop actions perform with higher fidelity via visual coordinates.',
        confidence: 0.88,
        suggestedAction: {
          type: 'drag',
          point: { x: 200, y: 300 },
          dragEnd: { x: 500, y: 300 }
        }
      }
    }

    // 4. Low DOM count / Obfuscated SPA
    if (context.interactiveElementCount < 3 && context.domReady) {
      return {
        mode: 'visual_gui',
        reason: 'Low interactive DOM element density (< 3). Page is likely an obfuscated custom UI.',
        confidence: 0.85,
        suggestedAction: {
          type: 'click',
          point: { x: 500, y: 300 }
        }
      }
    }

    // 5. Default Fast Path: DOM Automation (Playwright style)
    return {
      mode: 'dom',
      reason: 'Rich semantic DOM elements present. Fast deterministic selector/form automation prioritized.',
      confidence: 0.95,
      suggestedAction: {
        selector: intent.targetHint || 'input, button, a',
        method: intent.actionType === 'type' ? 'fill' : 'click'
      }
    }
  }

  /**
   * Evaluates if a failed DOM action should trigger immediate fallback to Visual GUI mode.
   */
  public shouldFallbackToVision(error: unknown, _intent: TaskIntent): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()

    // Common DOM automation failures that indicate visual control is needed
    return (
      message.includes('not found') ||
      message.includes('timeout') ||
      message.includes('obscured') ||
      message.includes('not visible') ||
      message.includes('pointer-events: none') ||
      message.includes('detached') ||
      message.includes('cross-origin frame')
    )
  }

  /**
   * Generates a fallback UI-TARS action when DOM execution encounters an obstacle.
   */
  public createFallbackVisualAction(
    targetDescription: string,
    approximatePoint?: { x: number; y: number }
  ): UITARSAction {
    return {
      type: 'click',
      point: approximatePoint ? uitarsEngine.fromScreenCoords(approximatePoint.x, approximatePoint.y, { width: 1920, height: 1080 }) : { x: 500, y: 500 },
      thought: `DOM execution failed for "${targetDescription}". Falling back to UI-TARS visual coordinate control.`
    }
  }
}

export const taskController = new BrowserTaskController()
