import { z } from 'zod'
import { relative } from 'node:path'
import type { BrowserState } from '@shared/types'
import type { ToolContext } from './types'
import { defineTool, toolResultError } from './types'
import { browserService } from '../../services/browser'
import { truncate } from '../../util'

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
  return [
    `URL: ${state.url || '(none)'}`,
    `Title: ${state.title || '(untitled)'}`,
    `Engine: ${state.engine === 'stagehand' ? 'Stagehand AI' : 'Built-in Chromium'} · ${state.mode ?? 'headless'}`,
    `Last action: ${state.lastAction ?? ''}`,
    `Blocked requests: ${state.blockedRequests ?? 0}`,
    ...(state.notice ? [`Notice: ${state.notice}`] : [])
  ].join('\n')
}

export const browserOpenTool = defineTool({
  name: 'browser_open',
  title: 'Open browser',
  description:
    'Open a URL in the native task browser. Stagehand AI is the default engine, with headless operation and user takeover; only verified public http/https destinations are allowed.',
  schema: z.object({ url: z.string().trim().url().max(8192) }),
  sideEffect: 'network',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      await browserService.open(scope(ctx), args.url)
      const state = await snapshot(ctx)
      return { content: `Opened page.\n${stateSummary(state)}\nScreenshot: ${state.screenshotRelPath ?? '(none)'}` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Open ${args.url}`
})

export const browserClickTool = defineTool({
  name: 'browser_click',
  title: 'Click in browser',
  description: 'Click the first element matching a CSS selector in the task browser.',
  schema: z.object({ selector: z.string().trim().min(1).max(2000) }),
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
    selector: z.string().trim().min(1).max(2000),
    text: z.string().max(100_000),
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
  schema: z.object({ selector: z.string().trim().min(1).max(2000), value: z.string().max(5000) }),
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
  schema: z.object({ key: z.string().trim().min(1).max(64) }),
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
    'Extract readable text (or inner text of a CSS selector) from the current page in the task browser.',
  schema: z.object({ selector: z.string().trim().min(1).max(2000).optional() }),
  sideEffect: 'read',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const result = await browserService.extract(scope(ctx), args.selector)
      ctx.setBrowser(ownedState(ctx, result.state))
      return { content: result.text }
    } catch (error) {
      return toolResultError(error)
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
    selector: z.string().trim().min(1).max(2000).optional(),
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
    try {
      const state = await browserService.show(scope(ctx))
      ctx.setBrowser(ownedState(ctx, state))
      return { content: `Browser window shown.\n${stateSummary(state)}` }
    } catch (error) {
      return toolResultError(error)
    }
  }
})

export const browserObserveTool = defineTool({
  name: 'browser_observe',
  title: 'Observe browser actions',
  description:
    'Use Stagehand AI to find relevant actionable elements on the current page and return real selectors. This is read-only; use browser_act only after reviewing the intended effect.',
  schema: z.object({ instruction: z.string().trim().min(1).max(2000).optional() }),
  sideEffect: 'read',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const actions = await browserService.observe(scope(ctx), args.instruction)
      ctx.setBrowser(ownedState(ctx, await browserService.state(scope(ctx))))
      return { content: truncate(JSON.stringify({ actions }, null, 2), 40_000) }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => args.instruction ? `Observe: ${args.instruction}` : 'Observe page actions'
})

export const browserActTool = defineTool({
  name: 'browser_act',
  title: 'Perform AI browser action',
  description:
    'Use Stagehand AI to perform one natural-language browser action. This can change remote state, submit forms, or make purchases; the user must approve every call. Never use it to bypass a denied action or CAPTCHA.',
  schema: z.object({ instruction: z.string().trim().min(1).max(2000) }),
  sideEffect: 'network',
  risk: 'high',
  approval: 'always',
  allowAlways: false,
  execute: async (args, ctx) => {
    try {
      const result = await browserService.act(scope(ctx), args.instruction)
      const state = await snapshot(ctx)
      return {
        content: `${result.actionDescription || result.message}\nActions performed: ${result.actions}\n${stateSummary(state)}`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `AI action: ${args.instruction}`
})

export const browserExtractStructuredTool = defineTool({
  name: 'browser_extract_structured',
  title: 'Extract structured browser data',
  description:
    'Use Stagehand AI and the task provider to extract schema-validated JSON from the current page. Optionally supply a JSON Schema with type "object"; page content is subject to the existing DLP policy.',
  schema: z.object({
    instruction: z.string().trim().min(1).max(4000),
    schema: z.record(z.string(), z.unknown()).optional()
  }),
  sideEffect: 'read',
  approval: 'never',
  execute: async (args, ctx) => {
    try {
      const data = await browserService.extractStructured(scope(ctx), args.instruction, args.schema)
      ctx.setBrowser(ownedState(ctx, await browserService.state(scope(ctx))))
      return { content: truncate(JSON.stringify(data, null, 2), 60_000) }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Extract JSON: ${args.instruction}`
})

export const browserTools = [
  browserOpenTool,
  browserObserveTool,
  browserActTool,
  browserExtractStructuredTool,
  browserClickTool,
  browserTypeTool,
  browserSelectTool,
  browserPressTool,
  browserScrollTool,
  browserExtractTool,
  browserScreenshotTool,
  browserBackTool,
  browserWaitTool,
  browserShowTool
]
