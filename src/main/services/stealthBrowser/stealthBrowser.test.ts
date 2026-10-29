import { describe, expect, it } from 'vitest'
import {
  camoufoxEngine,
  uitarsEngine,
  taskController,
  stealthSearchRouter,
  stealthBrowser
} from './index'

describe('Camoufox Stealth Engine', () => {
  it('generates stealth injection script removing webdriver and adding fingerprint noise', () => {
    const script = camoufoxEngine.getStealthInjectionScript()
    expect(script).toContain('navigator, \'webdriver\'')
    expect(script).toContain('HTMLCanvasElement.prototype.toDataURL')
    expect(script).toContain('Google Inc. (Intel)')
    expect(script).toContain('__camoufox_stealth_active__')
  })

  it('generates cubic Bézier human mouse curves with smooth coordinates', () => {
    const curve = camoufoxEngine.generateHumanCurve(100, 100, 500, 400, 20)
    expect(curve.length).toBe(21)
    expect(curve[0].x).toBe(100)
    expect(curve[0].y).toBe(100)
    expect(curve[curve.length - 1].x).toBe(500)
    expect(curve[curve.length - 1].y).toBe(400)
    expect(curve[10].x).toBeGreaterThan(100)
  })

  it('generates human jitter delays within bounded thresholds', () => {
    const delay = camoufoxEngine.getHumanJitterDelay(100, 30)
    expect(delay).toBeGreaterThanOrEqual(70)
    expect(delay).toBeLessThanOrEqual(130)
  })
})

describe('UI-TARS Visual GUI Engine', () => {
  it('scales normalized 0-1000 coordinates to viewport pixel space', () => {
    const viewport = { width: 1920, height: 1080 }
    const screenPoint = uitarsEngine.toScreenCoords({ x: 500, y: 500 }, viewport)
    expect(screenPoint).toEqual({ x: 960, y: 540 })

    const origin = uitarsEngine.toScreenCoords({ x: 0, y: 0 }, viewport)
    expect(origin).toEqual({ x: 0, y: 0 })

    const corner = uitarsEngine.toScreenCoords({ x: 1000, y: 1000 }, viewport)
    expect(corner).toEqual({ x: 1920, y: 1080 })
  })

  it('converts pixel coordinates back to normalized UI-TARS space', () => {
    const viewport = { width: 1920, height: 1080 }
    const norm = uitarsEngine.fromScreenCoords(960, 540, viewport)
    expect(norm).toEqual({ x: 500, y: 500 })
  })

  it('parses UI-TARS action grammar for click, type, drag, and scroll', () => {
    const clickAction = uitarsEngine.parseAction('Action: click(point=[450, 320])')
    expect(clickAction.type).toBe('click')
    expect(clickAction.point).toEqual({ x: 450, y: 320 })

    const typeAction = uitarsEngine.parseAction('Action: type(point=[120, 80], content="Hello World")')
    expect(typeAction.type).toBe('type')
    expect(typeAction.text).toBe('Hello World')
    expect(typeAction.point).toEqual({ x: 120, y: 80 })

    const dragAction = uitarsEngine.parseAction('Action: drag(start=[100, 200], end=[500, 200])')
    expect(dragAction.type).toBe('drag')
    expect(dragAction.point).toEqual({ x: 100, y: 200 })
    expect(dragAction.dragEnd).toEqual({ x: 500, y: 200 })

    const scrollAction = uitarsEngine.parseAction('Action: scroll(direction="down", amount=400)')
    expect(scrollAction.type).toBe('scroll')
    expect(scrollAction.scrollDirection).toBe('down')
    expect(scrollAction.scrollAmount).toBe(400)
  })

  it('formats UI-TARS actions into standard grammar', () => {
    const formatted = uitarsEngine.formatAction({
      type: 'click',
      point: { x: 300, y: 400 }
    })
    expect(formatted).toBe('Action: click(point=[300, 400])')
  })
})

describe('Browser Task Controller (Hybrid Router)', () => {
  it('routes to visual_gui when canvas elements or captchas are present', () => {
    const canvasContext = {
      url: 'https://docs.google.com/document/d/123',
      title: 'Google Docs',
      viewport: { width: 1920, height: 1080 },
      hasCanvas: true,
      hasCaptcha: false,
      interactiveElementCount: 2,
      domReady: true
    }

    const decision = taskController.decideExecutionPath({ goal: 'type text into doc' }, canvasContext)
    expect(decision.mode).toBe('visual_gui')
    expect(decision.reason).toContain('Canvas')

    const captchaContext = {
      ...canvasContext,
      hasCanvas: false,
      hasCaptcha: true
    }
    const captchaDecision = taskController.decideExecutionPath({ goal: 'click verify' }, captchaContext)
    expect(captchaDecision.mode).toBe('visual_gui')
    expect(captchaDecision.reason).toContain('CAPTCHA')
  })

  it('routes to dom automation for standard semantic HTML pages', () => {
    const htmlContext = {
      url: 'https://github.com/login',
      title: 'Sign In',
      viewport: { width: 1920, height: 1080 },
      hasCanvas: false,
      hasCaptcha: false,
      interactiveElementCount: 15,
      domReady: true
    }

    const decision = taskController.decideExecutionPath({ goal: 'enter email and submit' }, htmlContext)
    expect(decision.mode).toBe('dom')
    expect(decision.confidence).toBeGreaterThan(0.9)
  })

  it('detects when DOM failure warrants visual fallback', () => {
    const shouldFallback = taskController.shouldFallbackToVision(
      new Error('Element [data-testid="submit"] was obscured by an overlay'),
      { goal: 'click submit' }
    )
    expect(shouldFallback).toBe(true)
  })
})

describe('Stealth Search Router (Always-On Engine)', () => {
  it('initializes pre-warmed session in always-on mode', () => {
    expect(stealthSearchRouter.isReady()).toBe(true)
  })

  it('prepares visual interaction with Camoufox human curves', () => {
    const result = stealthBrowser.prepareVisualInteraction(
      { x: 200, y: 200 },
      { x: 500, y: 500 },
      { width: 1920, height: 1080 }
    )
    expect(result.targetScreenPos).toEqual({ x: 960, y: 540 })
    expect(result.curve.length).toBeGreaterThan(10)
  })
})
