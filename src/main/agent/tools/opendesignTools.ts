/**
 * OpenDesign & Impulse Skills Builtin Agent Tools.
 */
import type { AgentTool } from './types'
import { openDesignEngine } from '../../selfimpulse/opendesign/engine'
import { impulseSkillRegistry } from '../../selfimpulse/skills/lobeRegistry'
import { composioConnectors } from '../../selfimpulse/connectors/composio'

export const opendesignTools: AgentTool[] = [
  {
    name: 'opendesign_compile_tokens',
    title: 'Compile Design Tokens',
    description: 'Compile design tokens (colors, typography scales, spacing, shadows) based on brand requirements.',
    sideEffect: 'none',
    risk: 'low',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the design system or brand' },
        primaryColor: { type: 'string', description: 'Primary hex color e.g. #0096ff' },
        style: {
          type: 'string',
          enum: ['modern', 'minimal', 'glassmorphic', 'editorial'],
          description: 'Aesthetic theme'
        }
      },
      required: ['name']
    },
    execute: async (args) => {
      const tokens = openDesignEngine.compileTokens({
        name: String(args.name),
        primaryColor: args.primaryColor ? String(args.primaryColor) : undefined,
        style: args.style as any
      })
      return { content: JSON.stringify({ ok: true, tokens }, null, 2) }
    }
  },
  {
    name: 'opendesign_generate_prototype',
    title: 'Generate UI Prototype',
    description: 'Generate a sandboxed interactive HTML/JS prototype with compiled design system tokens.',
    sideEffect: 'write',
    risk: 'medium',
    approval: 'policy',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the prototype page/widget' },
        description: { type: 'string', description: 'Overview of purpose and behavior' },
        componentsHtml: { type: 'string', description: 'HTML markup for the UI components' },
        scriptJs: { type: 'string', description: 'Optional interactive JavaScript logic' }
      },
      required: ['title', 'description', 'componentsHtml']
    },
    execute: async (args, ctx) => {
      const prototype = openDesignEngine.generatePrototype({
        title: String(args.title),
        description: String(args.description),
        componentsHtml: String(args.componentsHtml),
        scriptJs: args.scriptJs ? String(args.scriptJs) : undefined
      })

      const path = await openDesignEngine.exportPrototype(ctx.workspace, prototype)
      return {
        content: JSON.stringify({
          ok: true,
          prototypeId: prototype.id,
          filePath: path,
          message: `Prototype '${prototype.title}' exported to workspace at ${path}`
        }, null, 2)
      }
    }
  },
  {
    name: 'impulse_search_skills',
    title: 'Search Impulse Skill Catalog',
    description: 'Search the local Impulse & LobeChat skill index (360K+ capabilities) for specialized tools.',
    sideEffect: 'none',
    risk: 'low',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords e.g. "document", "chart", "svg", "workflow"' },
        category: {
          type: 'string',
          enum: ['developer', 'design', 'productivity', 'analysis', 'automation', 'creative'],
          description: 'Optional category filter'
        }
      }
    },
    execute: async (args) => {
      const skills = impulseSkillRegistry.search(
        args.query ? String(args.query) : undefined,
        args.category ? String(args.category) : undefined
      )
      return {
        content: JSON.stringify({
          ok: true,
          count: skills.length,
          skills: skills.map((s) => ({
            identifier: s.identifier,
            name: s.name,
            category: s.category,
            description: s.description
          }))
        }, null, 2)
      }
    }
  },
  {
    name: 'composio_list_connectors',
    title: 'List Composio Connectors',
    description: 'List available Composio SaaS connectors (GitHub, Slack, Jira, Notion, Linear) and their status.',
    sideEffect: 'none',
    risk: 'low',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    execute: async () => {
      const connectors = composioConnectors.listConnectors()
      return {
        content: JSON.stringify({
          ok: true,
          connectors
        }, null, 2)
      }
    }
  }
]
