import { z } from 'zod'
import { memoryService } from '../../services/memory'
import { defineTool, type AgentTool } from './types'

const remember = defineTool({
  name: 'remember',
  title: 'Remember a durable note',
  description:
    'Save something that will still matter in future tasks: a stable preference, a working convention, ' +
    'or a fact about the user or their projects. Do not save API keys, passwords, personal secrets, ' +
    'one-off details, or anything the user asked you to forget.',
  schema: z.object({
    text: z.string().trim().min(4).max(4000).describe('The note, written as one clear statement.'),
    scope: z
      .enum(['global', 'workspace'])
      .default('global')
      .describe('Global notes apply everywhere. Workspace notes apply only in this task’s first granted folder.'),
    tags: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
    retentionDays: z.number().int().min(1).max(3650).optional()
      .describe('Expire after this many days. Omit to retain until explicitly removed.')
  }),
  sideEffect: 'write',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => {
    const scopeRef = args.scope === 'workspace' ? ctx.task.folders[0] : undefined
    if (args.scope === 'workspace' && !scopeRef) {
      return {
        content: 'This task has no granted folder, so a workspace note has nowhere to belong. Save it as global or skip it.',
        isError: true
      }
    }
    const notes = await memoryService.add(
      { text: args.text, scope: args.scope, scopeRef, tags: args.tags, retentionDays: args.retentionDays },
      'captain'
    )
    return {
      content: `Saved. Memory now holds ${notes.length} note${notes.length === 1 ? '' : 's'}.`
    }
  },
  summarize: (args) => `${args.scope === 'workspace' ? 'Workspace' : 'Global'} · ${args.text}`
})

const recall = defineTool({
  name: 'recall_memory',
  title: 'Recall saved notes',
  description:
    'Search the notes this device has saved for the user. Use it when the user refers to a preference, ' +
    'a decision, or context from earlier work that is not already in this conversation.',
  schema: z.object({
    query: z.string().trim().min(1).max(500).describe('What to look for, in a few words.')
  }),
  sideEffect: 'read',
  risk: 'low',
  approval: 'never',
  execute: async (args, ctx) => ({
    content: await memoryService.searchText(args.query, ctx.task.folders)
  }),
  summarize: (args) => args.query
})

export const memoryTools: AgentTool[] = [remember, recall]
