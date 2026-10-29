/**
 * UI-TARS Visual GUI Engine
 *
 * Implements the UI-TARS visual agent architecture:
 * 1. Normalized coordinate transforms (0-1000 range mapped to viewport pixel space).
 * 2. Visual action grammar parsing and formatting (click, drag, type, scroll, hotkey).
 * 3. Spatial reasoning utilities for visual GUI manipulation.
 */

import type { UITARSAction, UITARSActionType, UITARSPoint } from './types'

export class UITARSEngine {
  /**
   * Converts a normalized UI-TARS point (0-1000) into actual viewport pixel coordinates.
   */
  public toScreenCoords(
    point: UITARSPoint,
    viewport: { width: number; height: number }
  ): { x: number; y: number } {
    const clampedX = Math.max(0, Math.min(1000, point.x))
    const clampedY = Math.max(0, Math.min(1000, point.y))

    return {
      x: Math.round((clampedX / 1000) * viewport.width),
      y: Math.round((clampedY / 1000) * viewport.height)
    }
  }

  /**
   * Converts viewport pixel coordinates into normalized UI-TARS (0-1000) space.
   */
  public fromScreenCoords(
    x: number,
    y: number,
    viewport: { width: number; height: number }
  ): UITARSPoint {
    const normX = Math.round((x / Math.max(1, viewport.width)) * 1000)
    const normY = Math.round((y / Math.max(1, viewport.height)) * 1000)

    return {
      x: Math.max(0, Math.min(1000, normX)),
      y: Math.max(0, Math.min(1000, normY))
    }
  }

  /**
   * Parses raw action strings emitted by UI-TARS or VLM agent models.
   * Examples:
   *  Action: click(point=[482, 319])
   *  Action: type(point=[512, 108], content="Search query")
   *  Action: drag(start=[100, 200], end=[400, 200])
   *  Action: scroll(direction="down", amount=300)
   *  Action: hotkey(key="Enter")
   */
  public parseAction(rawText: string): UITARSAction {
    const text = rawText.trim()

    // 1. Click
    const clickMatch = text.match(/click\(point=\[(\d+),\s*(\d+)\]\)/i)
    if (clickMatch) {
      return {
        type: 'click',
        point: { x: parseInt(clickMatch[1], 10), y: parseInt(clickMatch[2], 10) }
      }
    }

    // 2. Double Click
    const dblMatch = text.match(/double_click\(point=\[(\d+),\s*(\d+)\]\)/i)
    if (dblMatch) {
      return {
        type: 'double_click',
        point: { x: parseInt(dblMatch[1], 10), y: parseInt(dblMatch[2], 10) }
      }
    }

    // 3. Right Click
    const rightMatch = text.match(/right_click\(point=\[(\d+),\s*(\d+)\]\)/i)
    if (rightMatch) {
      return {
        type: 'right_click',
        point: { x: parseInt(rightMatch[1], 10), y: parseInt(rightMatch[2], 10) }
      }
    }

    // 4. Type
    const typeMatch = text.match(/type\((?:point=\[(\d+),\s*(\d+)\],\s*)?(?:content|text)=["'](.*?)["']\)/i)
    if (typeMatch) {
      return {
        type: 'type',
        point: typeMatch[1] && typeMatch[2] ? { x: parseInt(typeMatch[1], 10), y: parseInt(typeMatch[2], 10) } : undefined,
        text: typeMatch[3]
      }
    }

    // 5. Drag
    const dragMatch = text.match(/drag\(start=\[(\d+),\s*(\d+)\],\s*end=\[(\d+),\s*(\d+)\]\)/i)
    if (dragMatch) {
      return {
        type: 'drag',
        point: { x: parseInt(dragMatch[1], 10), y: parseInt(dragMatch[2], 10) },
        dragEnd: { x: parseInt(dragMatch[3], 10), y: parseInt(dragMatch[4], 10) }
      }
    }

    // 6. Scroll
    const scrollMatch = text.match(/scroll\(direction=["'](up|down|left|right)["'](?:,\s*amount=(\d+))?\)/i)
    if (scrollMatch) {
      return {
        type: 'scroll',
        scrollDirection: scrollMatch[1].toLowerCase() as 'up' | 'down' | 'left' | 'right',
        scrollAmount: scrollMatch[2] ? parseInt(scrollMatch[2], 10) : 300
      }
    }

    // 7. Hotkey
    const hotkeyMatch = text.match(/hotkey\(key=["'](.*?)["']\)/i)
    if (hotkeyMatch) {
      return {
        type: 'hotkey',
        key: hotkeyMatch[1]
      }
    }

    // Default to wait if unparseable
    return {
      type: 'wait',
      waitMs: 500,
      thought: `Could not parse action from "${text}"; waiting.`
    }
  }

  /**
   * Formats an action object into the standardized UI-TARS action syntax.
   */
  public formatAction(action: UITARSAction): string {
    switch (action.type) {
      case 'click':
        return `Action: click(point=[${action.point?.x ?? 0}, ${action.point?.y ?? 0}])`
      case 'double_click':
        return `Action: double_click(point=[${action.point?.x ?? 0}, ${action.point?.y ?? 0}])`
      case 'right_click':
        return `Action: right_click(point=[${action.point?.x ?? 0}, ${action.point?.y ?? 0}])`
      case 'type':
        if (action.point) {
          return `Action: type(point=[${action.point.x}, ${action.point.y}], content="${action.text ?? ''}")`
        }
        return `Action: type(content="${action.text ?? ''}")`
      case 'drag':
        return `Action: drag(start=[${action.point?.x ?? 0}, ${action.point?.y ?? 0}], end=[${action.dragEnd?.x ?? 0}, ${action.dragEnd?.y ?? 0}])`
      case 'scroll':
        return `Action: scroll(direction="${action.scrollDirection ?? 'down'}", amount=${action.scrollAmount ?? 300})`
      case 'hotkey':
        return `Action: hotkey(key="${action.key ?? 'Enter'}")`
      case 'wait':
        return `Action: wait(ms=${action.waitMs ?? 1000})`
    }
  }
}

export const uitarsEngine = new UITARSEngine()
