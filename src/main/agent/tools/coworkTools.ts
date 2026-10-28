import { z } from 'zod'
import type { AgentTool, ToolContext, ToolResult } from './types'
import { CoworkKernel } from '../../cowork/coworkKernel'
import { LobeSkillRegistry } from '../../cowork/lobeSkillRegistry'

// Global shared kernel instance for runtime efficiency
const globalCoworkKernel = new CoworkKernel({ sessionId: 'selfimpulse_cowork_main' });
const globalSkillRegistry = new LobeSkillRegistry();

export const coworkKineticActuateTool: AgentTool = {
  name: 'cowork_kinetic_actuate',
  title: 'OS Kinetic Actuation',
  description: 'Simulates natural human-like mouse movements using cubic Bezier curves, clicks, and keyboard inputs across displays.',
  sideEffect: 'execute',
  risk: 'medium',
  approval: 'policy',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['click', 'double_click', 'right_click', 'hover', 'drag', 'type_text', 'key_combination'],
        description: 'Type of kinetic hardware event to simulate'
      },
      coordinates: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Target X coordinate' },
          y: { type: 'number', description: 'Target Y coordinate' },
          normalized: { type: 'boolean', description: 'Whether coordinates are normalized between 0.0 and 1.0' }
        },
        description: 'Target spatial screen coordinates'
      },
      textPayload: {
        type: 'string',
        description: 'Text string to type if action is type_text'
      }
    },
    required: ['action']
  },
  schema: z.object({
    action: z.enum(['click', 'double_click', 'right_click', 'hover', 'drag', 'type_text', 'key_combination']),
    coordinates: z.object({
      x: z.number(),
      y: z.number(),
      normalized: z.boolean().optional()
    }).optional(),
    textPayload: z.string().optional()
  }),
  execute: async (input: { action: any; coordinates?: any; textPayload?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const res = await globalCoworkKernel.kinetic.dispatchKineticEvent({
        kind: input.action,
        coordinates: input.coordinates,
        textPayload: input.textPayload
      });

      const currentPos = globalCoworkKernel.kinetic.getCurrentCoordinates();
      return {
        content: JSON.stringify({
          status: 'success',
          executed: res.success,
          pathPoints: res.executedPathPoints ?? 0,
          currentCursor: currentPos
        }, null, 2)
      };
    } catch (err: unknown) {
      return {
        content: `Kinetic actuation failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true
      };
    }
  }
};

export const coworkPerceiveDomTool: AgentTool = {
  name: 'cowork_perceive_dom',
  title: 'Perception DOM Inspection',
  description: 'Captures and distills live web pages into an accessibility tree, identifying clickable and interactive element nodes.',
  sideEffect: 'read',
  risk: 'low',
  approval: 'never',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Optional URL to navigate to before capturing snapshot'
      },
      queryIntent: {
        type: 'string',
        description: 'Optional element intent or label to locate in the page'
      }
    }
  },
  schema: z.object({
    url: z.string().optional(),
    queryIntent: z.string().optional()
  }),
  execute: async (input: { url?: string; queryIntent?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      if (input.url) {
        await globalCoworkKernel.lens.navigateTo(input.url);
      }

      const snapshot = globalCoworkKernel.lens.captureSnapshot();
      let locatedNode = null;

      if (input.queryIntent) {
        locatedNode = globalCoworkKernel.lens.getDomMatrix().locateElementByIntent(snapshot, input.queryIntent);
      }

      return {
        content: JSON.stringify({
          activeUrl: snapshot.activeUrl,
          totalNodes: snapshot.domTree.length,
          locatedElement: locatedNode,
          interactiveSample: snapshot.domTree.filter(n => n.isClickable || n.isTextInput).slice(0, 5)
        }, null, 2)
      };
    } catch (err: unknown) {
      return {
        content: `Perception inspection failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true
      };
    }
  }
};

export const coworkSearchSkillsTool: AgentTool = {
  name: 'cowork_search_skills',
  title: 'Skills & Tools Discovery',
  description: 'Searches the extensive catalog of 545+ indexed marketplace tools and skills across engineering, data, automation, and productivity.',
  sideEffect: 'read',
  risk: 'low',
  approval: 'never',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Keyword or intent to search across the skill catalog (e.g. "code", "browser", "shopping", "seo")'
      },
      category: {
        type: 'string',
        description: 'Optional category filter (e.g. "development", "tools", "automation")'
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default 8)'
      }
    },
    required: ['query']
  },
  schema: z.object({
    query: z.string(),
    category: z.string().optional(),
    limit: z.number().optional()
  }),
  execute: async (input: { query: string; category?: string; limit?: number }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const results = globalSkillRegistry.searchSkills(input.query, input.limit || 8);
      const items = results.map(r => ({
        id: r.skill.id,
        name: r.skill.name,
        category: r.skill.category,
        description: r.skill.description,
        tags: r.skill.tags,
        matchScore: r.matchScore,
        toolSchema: globalSkillRegistry.resolveToolSchema(r.skill.id)
      }));

      return {
        content: JSON.stringify({
          totalAvailable: globalSkillRegistry.getTotalSkillCount(),
          matchesFound: items.length,
          skills: items
        }, null, 2)
      };
    } catch (err: unknown) {
      return {
        content: `Skill discovery error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true
      };
    }
  }
};

export const coworkQuarantineCheckTool: AgentTool = {
  name: 'cowork_quarantine_check',
  title: 'Security Policy Guard',
  description: 'Evaluates actions against fail-closed security assertions to catch destructive filesystem commands, credential dumps, or unauthorized network calls.',
  sideEffect: 'none',
  risk: 'low',
  approval: 'never',
  inputSchema: {
    type: 'object',
    properties: {
      modality: {
        type: 'string',
        enum: ['tool', 'kinetic', 'perception', 'surface', 'cognitive']
      },
      actionName: {
        type: 'string'
      },
      payload: {
        type: 'object'
      }
    },
    required: ['modality', 'actionName', 'payload']
  },
  schema: z.object({
    modality: z.enum(['tool', 'kinetic', 'perception', 'surface', 'cognitive']),
    actionName: z.string(),
    payload: z.record(z.string(), z.unknown())
  }),
  execute: async (input: { modality: any; actionName: string; payload: Record<string, unknown> }, ctx: ToolContext): Promise<ToolResult> => {
    const decision = globalCoworkKernel.policy.evaluateAction(input.modality, input.actionName, input.payload);
    return {
      content: JSON.stringify({
        allowed: decision.allowed,
        requiresHumanApproval: decision.requiresHumanApproval,
        reason: decision.reason,
        matchedRule: decision.matchedRule ? decision.matchedRule.ruleId : null
      }, null, 2)
    };
  }
};

export const coworkTools: AgentTool[] = [
  coworkKineticActuateTool,
  coworkPerceiveDomTool,
  coworkSearchSkillsTool,
  coworkQuarantineCheckTool
];
