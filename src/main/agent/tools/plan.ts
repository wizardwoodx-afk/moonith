import { z } from 'zod'
import { defineTool } from './types'

export const updatePlanTool = defineTool({
  name: 'update_plan',
  title: 'Update plan',
  description:
    'Set or update the visible task plan. Call this before starting substantial multi-step work and update it as steps complete. Keep 2–8 concise steps.',
  schema: z.object({
    steps: z.array(z.string().min(1)).min(1).max(10).describe('Ordered plan steps.')
  }),
  sideEffect: 'none',
  execute: async (args, ctx) => {
    ctx.setPlan(args.steps)
    return { content: `Plan updated with ${args.steps.length} steps.` }
  },
  summarize: (args) => args.steps.join(' · ')
})

export const planTools = [updatePlanTool]
