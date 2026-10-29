/**
 * Stealth Browser Engine Contracts & Types
 * Incorporating Camoufox stealth anti-detect, UI-TARS visual GUI control,
 * and Browser Task Controller hybrid routing.
 */

export type AutomationMode = 'dom' | 'visual_gui' | 'hybrid'

export interface CamoufoxConfig {
  /** Target OS to emulate for fingerprinting */
  targetOs: 'windows' | 'macos' | 'linux'
  /** Locale and language spoofing */
  locale: string
  timezone: string
  /** Screen metrics */
  screen: {
    width: number
    height: number
    colorDepth: number
  }
  /** Hardware emulation */
  hardwareConcurrency: number
  deviceMemory: number
  /** Canvas & Audio noise jitter (defeats fingerprint hashing) */
  enableNoiseInjection: boolean
  /** Human-like mouse trajectory physics */
  humanMouseCurves: boolean
}

export interface MouseTrajectoryPoint {
  x: number
  y: number
  timestamp: number
}

export interface UITARSPoint {
  /** X coordinate in normalized 0-1000 space */
  x: number
  /** Y coordinate in normalized 0-1000 space */
  y: number
}

export type UITARSActionType =
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'type'
  | 'drag'
  | 'scroll'
  | 'hotkey'
  | 'wait'

export interface UITARSAction {
  type: UITARSActionType
  point?: UITARSPoint
  dragEnd?: UITARSPoint
  text?: string
  key?: string
  scrollDirection?: 'up' | 'down' | 'left' | 'right'
  scrollAmount?: number
  waitMs?: number
  thought?: string
}

export interface ControllerDecision {
  mode: AutomationMode
  reason: string
  confidence: number
  suggestedAction: UITARSAction | { selector: string; method: string; args?: unknown[] }
}

export interface StealthSearchResult {
  title: string
  url: string
  snippet: string
  engine: string
  publishedDate?: string
  verifiedSource?: boolean
}

export interface StealthSearchOutcome {
  query: string
  results: StealthSearchResult[]
  sourceEngine: string
  durationMs: number
  stealthEvaded: boolean
}

export interface BrowserPageContext {
  url: string
  title: string
  viewport: { width: number; height: number }
  hasCanvas: boolean
  hasCaptcha: boolean
  interactiveElementCount: number
  domReady: boolean
}
