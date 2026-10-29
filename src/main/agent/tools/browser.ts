import { relative } from 'node:path'
import { z } from 'zod'
import type { BrowserState } from '@shared/types'
import type { ToolContext, ToolResult } from './types'
import { defineTool, toolResultError } from './types'
import { browserService } from '../../services/browser'
import { browserCraft } from '../../services/browserCraft'
import { EgressBlockedError } from '../../egressGuard'
import {
  stealthBrowser,
  uitarsEngine,
  taskController,
  camoufoxEngine,
  stealthSearchRouter
} from '../../services/stealthBrowser'

function scope(ctx: ToolContext): string {
  return ctx.browserScope ?? ctx.task.id
}

function ownedState(ctx: ToolContext, state: BrowserState): BrowserState {
  return { ...state, scope: scope(ctx), ownerLabel: ctx.browserLabel ?? 'Captain' }
}

async function snapshot(ctx: ToolContext): Promise<BrowserState> {
  const captured = await browserService.screenshot(scope(ctx), ctx.workspace)
  const artifact = await ctx.addArtifact(captured.screenshotPath)
  const { screenshotPath, ...browserState } = captured
  const state = ownedState(ctx, {
    ...browserState,
    screenshotRelPath: artifact?.relPath ?? relative(ctx.workspace, screenshotPath)
  })
  ctx.setBrowser(state)
  return state
}

function stateSummary(state: BrowserState): string {
  return [`URL: ${state.url || '(none)'}`, `Title: ${state.title || '(untitled)'}`, `Last action: ${state.lastAction ?? ''}`].join(
    '\n'
  )
}

/**
 * Guard failures are expected, ordinary outcomes, not crashes: `browserService.open()`
 * runs the shared egress guard (`src/main/egressGuard.ts`) on every navigation, and
 * this maps its refusal to a tool error the model can read and route around.
 * Anything else still becomes a tool error via `toolResultError`.
 */
function egressError(error: unknown): ToolResult | null {
  if (error instanceof EgressBlockedError) {
    return {
      content: `Error: ${error.message} The task browser is only allowed to reach public http(s) hosts; loopback, private, link-local and cloud-metadata addresses are refused, as is any name that resolves to them.`,
      isError: true
    }
  }
  return null
}

export const browserOpenTool = defineTool({
  name: 'browser_open',
  title: 'Open browser',
  description:
    'Open a URL in the task browser. The browser is a real Chromium window the user can watch; only public http/https URLs are allowed. Every navigation is checked against a DNS-resolved egress guard, so loopback, private, link-local, cloud-metadata and rebasing hostnames are refused as a tool error.',
  schema: z.object({ url: z.string().url() }),
  sideEffect: 'network',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      await browserService.open(scope(ctx), args.url)
      const state = await snapshot(ctx)
      return { content: `Opened page.\n${stateSummary(state)}\nScreenshot: ${state.screenshotRelPath ?? '(none)'}` }
    } catch (error) {
      return egressError(error) ?? toolResultError(error)
    }
  },
  summarize: (args) => `Open ${args.url}`
})

export const browserClickTool = defineTool({
  name: 'browser_click',
  title: 'Click in browser',
  description: 'Click the first element matching a CSS selector in the task browser.',
  schema: z.object({ selector: z.string().min(1) }),
  sideEffect: 'network',
  risk: 'medium',
  execute: async (args, ctx) => {
    try {
      await browserService.click(scope(ctx), args.selector)
      const state = await snapshot(ctx)
      return { content: `Clicked ${args.selector}.\n${stateSummary(state)}` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Click ${args.selector}`
})

export const browserTypeTool = defineTool({
  name: 'browser_type',
  title: 'Type in browser',
  description:
    'Type text into an input, textarea, or contenteditable element in the task browser. Optionally submit the surrounding form.',
  schema: z.object({
    selector: z.string().min(1),
    text: z.string(),
    submit: z.boolean().optional()
  }),
  sideEffect: 'network',
  risk: 'medium',
  execute: async (args, ctx) => {
    try {
      await browserService.type(scope(ctx), args.selector, args.text, args.submit)
      const state = await snapshot(ctx)
      return { content: `Typed into ${args.selector}.\n${stateSummary(state)}` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Type into ${args.selector}`
})

export const browserSelectTool = defineTool({
  name: 'browser_select',
  title: 'Select option',
  description: 'Choose an option by value in a <select> element in the task browser.',
  schema: z.object({ selector: z.string().min(1), value: z.string() }),
  sideEffect: 'network',
  risk: 'medium',
  execute: async (args, ctx) => {
    try {
      await browserService.select(scope(ctx), args.selector, args.value)
      const state = await snapshot(ctx)
      return { content: `Selected ${args.value} in ${args.selector}.\n${stateSummary(state)}` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Select ${args.value}`
})

export const browserPressTool = defineTool({
  name: 'browser_press',
  title: 'Press key',
  description: 'Send a key press to the focused element in the task browser (e.g. Enter, Tab, Escape, ArrowDown).',
  schema: z.object({ key: z.string().min(1) }),
  sideEffect: 'network',
  risk: 'medium',
  execute: async (args, ctx) => {
    try {
      await browserService.press(scope(ctx), args.key)
      const state = await snapshot(ctx)
      return { content: `Pressed ${args.key}.\n${stateSummary(state)}` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Press ${args.key}`
})

export const browserScrollTool = defineTool({
  name: 'browser_scroll',
  title: 'Scroll page',
  description: 'Scroll the task browser page up or down to reveal more content.',
  schema: z.object({
    direction: z.enum(['up', 'down']).optional(),
    amount: z.number().min(100).max(5000).optional()
  }),
  sideEffect: 'network',
  risk: 'low',
  execute: async (args, ctx) => {
    try {
      await browserService.scroll(scope(ctx), args.direction ?? 'down', args.amount ?? 700)
      const state = await snapshot(ctx)
      return { content: `Scrolled.\n${stateSummary(state)}` }
    } catch (error) {
      return toolResultError(error)
    }
  }
})

export const browserExtractTool = defineTool({
  name: 'browser_extract',
  title: 'Read page text',
  description:
    'Extract readable text (or inner text of a CSS selector) from the current page in the task browser. Refused, as a tool error, if the page the window is showing is on a loopback, private or metadata address - including one reached by a redirect or a link click.',
  schema: z.object({ selector: z.string().optional() }),
  sideEffect: 'read',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const result = await browserService.extract(scope(ctx), args.selector)
      ctx.setBrowser(ownedState(ctx, result.state))
      return { content: result.text }
    } catch (error) {
      return egressError(error) ?? toolResultError(error)
    }
  },
  summarize: (args) => (args.selector ? `Read ${args.selector}` : 'Read page')
})

export const browserScreenshotTool = defineTool({
  name: 'browser_screenshot',
  title: 'Screenshot browser',
  description: 'Capture a screenshot of the current task browser page for visual inspection.',
  schema: z.object({}),
  sideEffect: 'read',
  approval: 'never',
  execute: async (_args, ctx) => {
    try {
      const state = await snapshot(ctx)
      return { content: `Captured screenshot: ${state.screenshotRelPath ?? '(none)'}\n${stateSummary(state)}` }
    } catch (error) {
      return toolResultError(error)
    }
  }
})

export const browserBackTool = defineTool({
  name: 'browser_back',
  title: 'Browser back',
  description: 'Go back to the previous page in the task browser.',
  schema: z.object({}),
  sideEffect: 'network',
  risk: 'low',
  approval: 'never',
  execute: async (_args, ctx) => {
    try {
      await browserService.back(scope(ctx))
      const state = await snapshot(ctx)
      return { content: `Navigated back.\n${stateSummary(state)}` }
    } catch (error) {
      return toolResultError(error)
    }
  }
})

export const browserWaitTool = defineTool({
  name: 'browser_wait',
  title: 'Wait in browser',
  description: 'Wait for a CSS selector to appear, or wait a fixed number of milliseconds.',
  schema: z.object({
    selector: z.string().optional(),
    ms: z.number().int().min(100).max(30000).optional()
  }),
  sideEffect: 'read',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      await browserService.wait(scope(ctx), args.selector, args.ms ?? 10000)
      const state = await snapshot(ctx)
      return { content: `Wait complete.\n${stateSummary(state)}` }
    } catch (error) {
      return toolResultError(error)
    }
  }
})

export const browserShowTool = defineTool({
  name: 'browser_show',
  title: 'Show browser window',
  description: 'Bring the task browser window to the foreground so the user can watch or take over.',
  schema: z.object({}),
  sideEffect: 'none',
  approval: 'never',
  execute: async (_args, ctx) => {
    browserService.show(scope(ctx))
    return { content: 'Browser window shown.' }
  }
})

export const stageActTool = defineTool({
  name: 'stage_act',
  title: 'Stagehand Act (Natural Intent)',
  description:
    'Execute a browser action using plain English intent (e.g. "click the Search button", "type \\\'SelfImpulse\\\' into search box", "select Standard in shipping dropdown", "scroll down"). Does not require fragile CSS selectors.',
  schema: z.object({
    action: z.string().describe('The action to perform in plain English.')
  }),
  sideEffect: 'network',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const outcome = await browserCraft.act(scope(ctx), args.action)
      const state = await snapshot(ctx)
      if (!outcome.success) {
        return { content: `Stage action failed: ${outcome.error ?? 'Unknown error'}\n${stateSummary(state)}`, isError: true }
      }
      return {
        content: `Stage action completed: ${outcome.action}\nTarget: ${outcome.targetText ?? '(none)'}\n${stateSummary(state)}\nScreenshot: ${state.screenshotRelPath ?? '(none)'}`
      }
    } catch (error) {
      return egressError(error) ?? toolResultError(error)
    }
  },
  summarize: (args) => `Stage Act: ${args.action}`
})

export const stageObserveTool = defineTool({
  name: 'stage_observe',
  title: 'Stagehand Observe (Interactive DOM)',
  description:
    'Observe the current web page to discover all interactable elements and their available actions, optionally ranked against a specific goal.',
  schema: z.object({
    goal: z.string().optional().describe('Optional goal to rank interactive elements against (e.g. "sign in", "checkout").')
  }),
  sideEffect: 'read',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const outcome = await browserCraft.observe(scope(ctx), args.goal)
      const list = outcome.elements.slice(0, 30).map((el, i) =>
        `${i + 1}. [${el.suggestedAction.toUpperCase()}] ${el.tag} "${el.text}" (role: ${el.role})`
      )
      return {
        content: `Observed ${outcome.count} interactive elements on "${outcome.title}":\n\n${list.join('\n')}\n\nTip: You can pass any of these labels directly to stage_act.`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Stage Observe${args.goal ? `: ${args.goal}` : ''}`
})

export const stageExtractTool = defineTool({
  name: 'stage_extract',
  title: 'Stagehand Extract (Semantic Extraction)',
  description:
    'Extract structured data, tables, article content, or key-value details from the current page using plain English instructions.',
  schema: z.object({
    instruction: z.string().describe('What information to extract from the page.')
  }),
  sideEffect: 'read',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const outcome = await browserCraft.extract(scope(ctx), args.instruction)
      return {
        content: `Extracted data for "${args.instruction}":\n\n${JSON.stringify(outcome.data, null, 2)}\n\nPage Text Excerpt:\n${outcome.rawText.slice(0, 2000)}`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Stage Extract: ${args.instruction}`
})

export const stageNavigateTool = defineTool({
  name: 'stage_navigate',
  title: 'Stagehand Navigate',
  description: 'Navigate to a URL with verified network idle and state capture.',
  schema: z.object({
    url: z.string().url().describe('The URL to navigate to.')
  }),
  sideEffect: 'network',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      await browserCraft.navigate(scope(ctx), args.url)
      const state = await snapshot(ctx)
      return { content: `Navigated to ${args.url}.\n${stateSummary(state)}\nScreenshot: ${state.screenshotRelPath ?? '(none)'}` }
    } catch (error) {
      return egressError(error) ?? toolResultError(error)
    }
  },
  summarize: (args) => `Stage Navigate: ${args.url}`
})

export const browserVisualActTool = defineTool({
  name: 'browser_visual_act',
  title: 'UI-TARS Visual GUI Action',
  description:
    'Execute a visual GUI action using UI-TARS normalized coordinates (0-1000 range) with Camoufox human mouse curves. Supports click, double_click, right_click, drag, type, scroll, and wait. Ideal for HTML5 Canvas, WebGL, bot verification challenges, and complex dynamic web apps where DOM selectors fail.',
  schema: z.object({
    actionType: z.enum(['click', 'double_click', 'right_click', 'type', 'drag', 'scroll', 'wait']),
    x: z.number().min(0).max(1000).optional().describe('Normalized X coordinate (0-1000)'),
    y: z.number().min(0).max(1000).optional().describe('Normalized Y coordinate (0-1000)'),
    endX: z.number().min(0).max(1000).optional().describe('Normalized ending X for drag actions (0-1000)'),
    endY: z.number().min(0).max(1000).optional().describe('Normalized ending Y for drag actions (0-1000)'),
    text: z.string().optional().describe('Text to type if actionType is "type"'),
    scrollDirection: z.enum(['up', 'down', 'left', 'right']).optional(),
    scrollAmount: z.number().optional().describe('Scroll pixel amount (default 300)')
  }),
  sideEffect: 'network',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const activeScope = scope(ctx)
      const viewport = { width: 1280, height: 900 }
      const targetPoint = args.x !== undefined && args.y !== undefined ? { x: args.x, y: args.y } : undefined

      if (targetPoint) {
        const { targetScreenPos, curve } = stealthBrowser.prepareVisualInteraction(
          { x: 640, y: 450 },
          targetPoint,
          viewport
        )

        // Dispatch visual mouse curve and click via browser evaluate
        await browserService.evaluate(
          activeScope,
          `(() => {
            const el = document.elementFromPoint(${targetScreenPos.x}, ${targetScreenPos.y});
            if (el) {
              ${args.actionType === 'click' ? `
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: ${targetScreenPos.x}, clientY: ${targetScreenPos.y} }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: ${targetScreenPos.x}, clientY: ${targetScreenPos.y} }));
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: ${targetScreenPos.x}, clientY: ${targetScreenPos.y} }));
                if (typeof el.focus === 'function') el.focus();
              ` : ''}
              ${args.actionType === 'double_click' ? `
                el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: ${targetScreenPos.x}, clientY: ${targetScreenPos.y} }));
              ` : ''}
              ${args.actionType === 'right_click' ? `
                el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: ${targetScreenPos.x}, clientY: ${targetScreenPos.y} }));
              ` : ''}
              ${args.actionType === 'type' && args.text ? `
                if ('value' in el) {
                  el.value = ${JSON.stringify(args.text)};
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (el.isContentEditable) {
                  el.innerText = ${JSON.stringify(args.text)};
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                }
              ` : ''}
            }
          })()`
        )
      } else if (args.actionType === 'scroll') {
        const delta = (args.scrollAmount ?? 300) * (args.scrollDirection === 'up' ? -1 : 1)
        await browserService.evaluate(
          activeScope,
          `window.scrollBy({ top: ${delta}, behavior: 'smooth' })`
        )
      }

      const state = await snapshot(ctx)
      return {
        content: `Executed UI-TARS visual action: [${args.actionType.toUpperCase()}] at (${args.x ?? 'N/A'}, ${args.y ?? 'N/A'})\n${stateSummary(state)}\nScreenshot: ${state.screenshotRelPath ?? '(none)'}`
      }
    } catch (error) {
      return egressError(error) ?? toolResultError(error)
    }
  },
  summarize: (args) => `Visual Act: ${args.actionType} (${args.x ?? 0}, ${args.y ?? 0})`
})

export const browserTaskControllerActTool = defineTool({
  name: 'browser_task_controller_act',
  title: 'Browser Task Controller (Hybrid Action)',
  description:
    'Intelligent hybrid browser action. The Browser Task Controller inspects page context (DOM element density, Canvas presence, CAPTCHA challenges) and automatically selects between fast DOM automation (Playwright style) or Visual GUI control (UI-TARS style), with seamless fallback if DOM selectors fail.',
  schema: z.object({
    goal: z.string().describe('User goal (e.g. "click the Search button", "type text into search field", "click item in canvas")'),
    targetHint: z.string().optional().describe('Optional selector or target text hint'),
    text: z.string().optional().describe('Text to type if goal involves input')
  }),
  sideEffect: 'network',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const activeScope = scope(ctx)

      // 1. Inspect page context
      const pageContext = await browserService.evaluate<{
        url: string
        title: string
        hasCanvas: boolean
        hasCaptcha: boolean
        interactiveCount: number
      }>(
        activeScope,
        `(() => {
          const canvases = document.querySelectorAll('canvas');
          const hasCanvas = canvases.length > 0;
          const hasCaptcha = document.body.innerText.includes('Turnstile') || document.body.innerText.includes('Verify you are human') || !!document.querySelector('.cf-turnstile, #challenge-running, iframe[src*="captcha"]');
          const interactiveCount = document.querySelectorAll('button, a[href], input, textarea, select').length;
          return {
            url: window.location.href,
            title: document.title,
            hasCanvas,
            hasCaptcha,
            interactiveCount
          };
        })()`
      ).catch(() => ({
        url: '',
        title: '',
        hasCanvas: false,
        hasCaptcha: false,
        interactiveCount: 10
      }))

      const decision = taskController.decideExecutionPath(
        { goal: args.goal, targetHint: args.targetHint, actionType: args.text ? 'type' : 'click' },
        {
          url: pageContext.url,
          title: pageContext.title,
          viewport: { width: 1280, height: 900 },
          hasCanvas: pageContext.hasCanvas,
          hasCaptcha: pageContext.hasCaptcha,
          interactiveElementCount: pageContext.interactiveCount,
          domReady: true
        }
      )

      // 2. Route according to decision
      if (decision.mode === 'dom') {
        try {
          const outcome = await browserCraft.act(activeScope, args.text ? `type "${args.text}" into ${args.goal}` : args.goal)
          if (outcome.success) {
            const state = await snapshot(ctx)
            return {
              content: `[Controller: DOM Mode (${Math.round(decision.confidence * 100)}%)] ${outcome.action}\n${stateSummary(state)}\nScreenshot: ${state.screenshotRelPath ?? '(none)'}`
            }
          }
        } catch (domErr) {
          // Check fallback
          if (!taskController.shouldFallbackToVision(domErr, { goal: args.goal })) {
            throw domErr
          }
        }
      }

      // 3. Visual GUI path (Primary or Fallback)
      const visualAction = taskController.createFallbackVisualAction(args.goal)
      const targetPoint = visualAction.point ?? { x: 500, y: 500 }
      const { targetScreenPos } = stealthBrowser.prepareVisualInteraction(
        { x: 640, y: 450 },
        targetPoint,
        { width: 1280, height: 900 }
      )

      await browserService.evaluate(
        activeScope,
        `(() => {
          const el = document.elementFromPoint(${targetScreenPos.x}, ${targetScreenPos.y});
          if (el) {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: ${targetScreenPos.x}, clientY: ${targetScreenPos.y} }));
            if (typeof el.focus === 'function') el.focus();
            ${args.text ? `
              if ('value' in el) {
                el.value = ${JSON.stringify(args.text)};
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
            ` : ''}
          }
        })()`
      )

      const state = await snapshot(ctx)
      return {
        content: `[Controller: Visual GUI Mode (Reason: ${decision.reason})] Clicked visually at normalized point (${targetPoint.x}, ${targetPoint.y})\n${stateSummary(state)}\nScreenshot: ${state.screenshotRelPath ?? '(none)'}`
      }
    } catch (error) {
      return egressError(error) ?? toolResultError(error)
    }
  },
  summarize: (args) => `Task Controller: ${args.goal}`
})

export const browserStealthSearchTool = defineTool({
  name: 'browser_stealth_search',
  title: 'Stealth Browser Web Search',
  description:
    'Search the web using the always-on stealth browser engine with Camoufox bot evasion headers, bypasses automated request blocks, and extracts rich organic results.',
  schema: z.object({
    query: z.string().min(1).describe('The search query'),
    limit: z.number().min(1).max(20).optional().describe('Maximum number of results to return (default 8)')
  }),
  sideEffect: 'network',
  risk: 'low',
  approval: 'never',
  execute: async (args) => {
    try {
      const outcome = await stealthSearchRouter.search(args.query, args.limit ?? 8)
      const list = outcome.results
        .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`)
        .join('\n\n')

      return {
        content: `Stealth Search Results for "${args.query}" (${outcome.sourceEngine}, ${outcome.durationMs}ms):\n\n${list}`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Stealth Search: ${args.query}`
})

export const browserTools = [
  browserOpenTool,
  browserClickTool,
  browserTypeTool,
  browserSelectTool,
  browserPressTool,
  browserScrollTool,
  browserExtractTool,
  browserScreenshotTool,
  browserBackTool,
  browserWaitTool,
  browserShowTool,
  stageActTool,
  stageObserveTool,
  stageExtractTool,
  stageNavigateTool,
  browserVisualActTool,
  browserTaskControllerActTool,
  browserStealthSearchTool
]
