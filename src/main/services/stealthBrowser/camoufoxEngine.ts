/**
 * Camoufox Stealth Engine
 *
 * Emulates the Firefox-based Camoufox anti-detect browser core:
 * 1. Fingerprint synthesizer (Canvas/WebGL/AudioContext noise, OS and hardware spoofing).
 * 2. Human-like mouse trajectory generator using cubic Bézier physics and micro-jitter.
 * 3. Bot evasion patches (navigator.webdriver removal, Chrome/Firefox signature alignment).
 */

import type { CamoufoxConfig, MouseTrajectoryPoint } from './types'

export const DEFAULT_CAMOUFOX_CONFIG: CamoufoxConfig = {
  targetOs: 'windows',
  locale: 'en-US',
  timezone: 'America/New_York',
  screen: {
    width: 1920,
    height: 1080,
    colorDepth: 24
  },
  hardwareConcurrency: 8,
  deviceMemory: 16,
  enableNoiseInjection: true,
  humanMouseCurves: true
}

export class CamoufoxEngine {
  private config: CamoufoxConfig

  constructor(config: Partial<CamoufoxConfig> = {}) {
    this.config = { ...DEFAULT_CAMOUFOX_CONFIG, ...config }
  }

  public getConfig(): CamoufoxConfig {
    return { ...this.config }
  }

  public updateConfig(patch: Partial<CamoufoxConfig>): void {
    this.config = { ...this.config, ...patch }
  }

  /**
   * Generates the stealth injection script executed in the browser context before any page script runs.
   * Defeats Cloudflare, Akamai, DataDome, and Kasada fingerprinting tests.
   */
  public getStealthInjectionScript(): string {
    const { hardwareConcurrency, deviceMemory, enableNoiseInjection, screen } = this.config

    return `
      (() => {
        try {
          // 1. Remove automation indicators
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true
          });

          // 2. Hardware and concurrency spoofing
          Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: () => ${hardwareConcurrency},
            configurable: true
          });
          Object.defineProperty(navigator, 'deviceMemory', {
            get: () => ${deviceMemory},
            configurable: true
          });

          // 3. Screen metrics alignment
          Object.defineProperty(window.screen, 'width', { get: () => ${screen.width} });
          Object.defineProperty(window.screen, 'height', { get: () => ${screen.height} });
          Object.defineProperty(window.screen, 'availWidth', { get: () => ${screen.width} });
          Object.defineProperty(window.screen, 'availHeight', { get: () => ${screen.height - 40} });
          Object.defineProperty(window.screen, 'colorDepth', { get: () => ${screen.colorDepth} });

          // 4. Languages and Plugins
          Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
            configurable: true
          });

          // 5. Canvas noise injection (defeats canvas hashing)
          ${enableNoiseInjection ? `
          const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
          HTMLCanvasElement.prototype.toDataURL = function(...args) {
            const ctx = this.getContext('2d');
            if (ctx && this.width > 0 && this.height > 0) {
              try {
                const imgData = ctx.getImageData(0, 0, Math.min(this.width, 10), Math.min(this.height, 10));
                // Add imperceptible 1-bit noise to prevent static hashing
                imgData.data[0] = (imgData.data[0] ^ 1);
                ctx.putImageData(imgData, 0, 0);
              } catch (_) {}
            }
            return origToDataURL.apply(this, args);
          };

          const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
          CanvasRenderingContext2D.prototype.getImageData = function(...args) {
            const res = origGetImageData.apply(this, args);
            if (res.data.length > 4) {
              res.data[3] = Math.max(1, (res.data[3] ^ 1));
            }
            return res;
          };
          ` : ''}

          // 6. WebGL vendor and renderer spoofing
          const origGetParameter = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(param) {
            // UNMASKED_VENDOR_WEBGL = 37445
            if (param === 37445) return 'Google Inc. (Intel)';
            // UNMASKED_RENDERER_WEBGL = 37446
            if (param === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)';
            return origGetParameter.apply(this, [param]);
          };

          // 7. AudioContext fingerprint randomization
          ${enableNoiseInjection ? `
          const origGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
          AnalyserNode.prototype.getFloatFrequencyData = function(array) {
            origGetFloatFrequencyData.apply(this, [array]);
            for (let i = 0; i < array.length; i += 10) {
              array[i] += (Math.random() - 0.5) * 0.001;
            }
          };
          ` : ''}

          window.__camoufox_stealth_active__ = true;
        } catch (e) {
          console.warn('[Camoufox] Stealth injection note:', e);
        }
      })();
    `
  }

  /**
   * Generates a realistic human-like mouse movement trajectory between two points
   * using a cubic Bézier curve with randomized control points and acceleration/deceleration.
   */
  public generateHumanCurve(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    steps = 25
  ): MouseTrajectoryPoint[] {
    const points: MouseTrajectoryPoint[] = []
    const now = Date.now()

    if (!this.config.humanMouseCurves || steps <= 1) {
      return [
        { x: startX, y: startY, timestamp: now },
        { x: endX, y: endY, timestamp: now + 50 }
      ]
    }

    // Generate random control points for cubic Bézier curve
    const distance = Math.hypot(endX - startX, endY - startY)
    const deviation = Math.min(distance * 0.3, 100)

    const cp1X = startX + (endX - startX) * 0.25 + (Math.random() - 0.5) * deviation
    const cp1Y = startY + (endY - startY) * 0.25 + (Math.random() - 0.5) * deviation

    const cp2X = startX + (endX - startX) * 0.75 + (Math.random() - 0.5) * deviation
    const cp2Y = startY + (endY - startY) * 0.75 + (Math.random() - 0.5) * deviation

    let totalDuration = Math.max(120, Math.min(600, distance * 0.8))

    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      // Ease in and out (human motor control acceleration and deceleration)
      const easedT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t

      // Cubic Bézier formula
      const u = 1 - easedT
      const tt = easedT * easedT
      const uu = u * u
      const uuu = uu * u
      const ttt = tt * easedT

      let x = uuu * startX + 3 * uu * easedT * cp1X + 3 * u * tt * cp2X + ttt * endX
      let y = uuu * startY + 3 * uu * easedT * cp1Y + 3 * u * tt * cp2Y + ttt * endY

      // Add slight micro-wobble towards middle of trajectory
      if (i > 2 && i < steps - 2) {
        x += (Math.random() - 0.5) * 1.5
        y += (Math.random() - 0.5) * 1.5
      }

      points.push({
        x: Math.round(x),
        y: Math.round(y),
        timestamp: Math.round(now + (i / steps) * totalDuration)
      })
    }

    return points
  }

  /**
   * Generates human delay with jitter (e.g. between typing keystrokes or clicks)
   */
  public getHumanJitterDelay(baseMs = 80, jitterMs = 40): number {
    return Math.max(15, Math.round(baseMs + (Math.random() * 2 - 1) * jitterMs))
  }
}

export const camoufoxEngine = new CamoufoxEngine()
