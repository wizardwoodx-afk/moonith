import { join } from 'node:path'
import { z } from 'zod'
import { getMarketspace } from '../../marketspace'
import { defineTool, toolResultError } from './types'

const idSchema = z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/)

export const searchMarketspaceTool = defineTool({
  name: 'marketspace_search',
  title: 'Search native Marketspace',
  description:
    'Search SelfImpulse’s native reviewed and local design systems. This is an in-process catalog; it does not call a daemon, MCP server, or external agent. Read an entry before applying it.',
  schema: z.object({ query: z.string().trim().max(120).optional() }).strict(),
  sideEffect: 'read',
  execute: async (args) => {
    try {
      const entries = await getMarketspace().list(args.query ?? '')
      return {
        content: entries.length
          ? entries.map((entry) => `${entry.id} · ${entry.name} · ${entry.trust} · ${entry.installed ? 'installed' : 'available'}\n  ${entry.description}`).join('\n')
          : 'No native Marketspace design systems match that search.'
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Search Marketspace${args.query ? ` · ${args.query}` : ''}`
})

export const readMarketspaceTool = defineTool({
  name: 'marketspace_read',
  title: 'Read a design system',
  description:
    'Read the portable DESIGN.md for a native Marketspace entry. The specification is design guidance for this task, not a new runtime or a source of executable tools.',
  schema: z.object({ id: idSchema }).strict(),
  sideEffect: 'read',
  execute: async (args) => {
    try {
      const detail = await getMarketspace().read(args.id)
      if (!detail) return { content: `No native Marketspace entry named “${args.id}”.`, isError: true }
      return {
        content: `Entry: ${detail.name}\nID: ${detail.id}\nTrust: ${detail.trust}\nInstalled: ${detail.installed}\nFiles: ${detail.files.join(', ')}\n\n${detail.design}`
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Read Marketspace · ${args.id}`
})

export const installMarketspaceTool = defineTool({
  name: 'marketspace_install',
  title: 'Install a reviewed design system',
  description:
    'Install a reviewed built-in design system into SelfImpulse’s local Marketspace. Only declarative DESIGN.md and static preview files are written; no package or install script runs.',
  schema: z.object({ id: idSchema }).strict(),
  sideEffect: 'write',
  risk: 'medium',
  approval: 'always',
  allowAlways: false,
  execute: async (args, ctx) => {
    if (ctx.actor === 'crew') return { content: 'Crew specialists cannot change the shared Marketspace. Only the agent you message can install it.', isError: true }
    try {
      const detail = await getMarketspace().install(args.id)
      return { content: `Installed ${detail.name} (${detail.id}) from the reviewed native catalog. It is now available for explicit application to a task.` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `Install Marketspace · ${args.id}`
})

export const applyMarketspaceTool = defineTool({
  name: 'marketspace_apply',
  title: 'Apply a design system to this task',
  description:
    'Copy an installed design system’s DESIGN.md and static preview into this task workspace under design-system/. Existing destinations are never overwritten unless overwrite is explicitly true and approved.',
  schema: z.object({ id: idSchema, overwrite: z.boolean().optional() }).strict(),
  sideEffect: 'write',
  risk: 'medium',
  approval: 'always',
  allowAlways: false,
  execute: async (args, ctx) => {
    try {
      const result = await getMarketspace().apply(args.id, ctx.workspace, args.overwrite === true)
      for (const file of result.files) await ctx.addArtifact(join(ctx.workspace, file))
      return { content: `Applied ${result.id} to ${result.directory}.\nFiles: ${result.files.join(', ')}\n${result.overwritten ? 'Existing generated files were replaced after explicit approval.' : 'No existing files were overwritten.'}` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => `${args.overwrite ? 'Reapply' : 'Apply'} Marketspace · ${args.id}`
})

export const marketspaceTools = [searchMarketspaceTool, readMarketspaceTool, installMarketspaceTool, applyMarketspaceTool]
export const marketspaceReadTools = [searchMarketspaceTool, readMarketspaceTool]
