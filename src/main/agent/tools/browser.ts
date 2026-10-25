import { z } from 'zod'
import { relative } from 'node:path'
import type { BrowserState } from '@shared/types'
import type { ToolContext } from './types'
import { defineTool, toolResultError } from './types'
import { browserService } from '../../services/browser'

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

export const browserOpenTool = defineTool({
  name: 'browser_open',
  title: 'Open browser',
  description:
    'Open a URL in the task browser. The browser is a real Chromium window the user can watch; only http/https URLs are allowed.',
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
      return toolResultError(error)
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
    'Extract readable text (or inner text of a CSS selector) from the current page in the task browser.',
  schema: z.object({ selector: z.string().optional() }),
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
  browserShowTool
]
