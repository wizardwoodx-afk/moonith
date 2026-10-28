import { z } from 'zod'
import type { AgentTool, ToolContext, ToolResult } from './types'
import { RookKernel } from '../../rook/rookKernel'

const globalRookKernel = new RookKernel();

export const rookVisualGroundTool: AgentTool = {
  name: 'rook_visual_ground',
  title: 'Visual GUI Grounding',
  description: 'Converts normalized [0, 1000] bounding boxes from vision perception into exact physical pixel coordinates and centers.',
  sideEffect: 'read',
  risk: 'low',
  approval: 'never',
  inputSchema: {
    type: 'object',
    properties: {
      box: {
        type: 'object',
        properties: {
          ymin: { type: 'number', description: 'Normalized top bound (0-1000)' },
          xmin: { type: 'number', description: 'Normalized left bound (0-1000)' },
          ymax: { type: 'number', description: 'Normalized bottom bound (0-1000)' },
          xmax: { type: 'number', description: 'Normalized right bound (0-1000)' }
        },
        required: ['ymin', 'xmin', 'ymax', 'xmax']
      }
    },
    required: ['box']
  },
  schema: z.object({
    box: z.object({
      ymin: z.number(),
      xmin: z.number(),
      ymax: z.number(),
      xmax: z.number()
    })
  }),
  execute: async (input: { box: { ymin: number; xmin: number; ymax: number; xmax: number } }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const physical = globalRookKernel.grounding.denormalizeBox(input.box);
      const center = globalRookKernel.grounding.getCenterPoint(input.box);

      return {
        content: JSON.stringify({
          status: 'success',
          physicalBounds: physical,
          centerCoordinates: center
        }, null, 2)
      };
    } catch (err: unknown) {
      return {
        content: `Visual grounding error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true
      };
    }
  }
};

export const rookGuiActuateTool: AgentTool = {
  name: 'rook_gui_actuate',
  title: 'GUI Input Actuation',
  description: 'Dispatches smooth natural mouse trajectories, clicks, drags, keystrokes, and hotkeys to OS and application interfaces.',
  sideEffect: 'execute',
  risk: 'medium',
  approval: 'policy',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['click', 'double_click', 'right_click', 'drag', 'type_text', 'hotkey', 'scroll']
      },
      coordinates: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' }
        }
      },
      dragTarget: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' }
        }
      },
      text: { type: 'string' },
      keys: { type: 'array', items: { type: 'string' } }
    },
    required: ['action']
  },
  schema: z.object({
    action: z.enum(['click', 'double_click', 'right_click', 'drag', 'type_text', 'hotkey', 'scroll']),
    coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
    dragTarget: z.object({ x: z.number(), y: z.number() }).optional(),
    text: z.string().optional(),
    keys: z.array(z.string()).optional()
  }),
  execute: async (input: any, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const turn = await globalRookKernel.executeVisualAction(input);
      return {
        content: JSON.stringify({
          status: 'success',
          executedAction: input.action,
          details: turn.output
        }, null, 2)
      };
    } catch (err: unknown) {
      return {
        content: `GUI actuation failure: ${err instanceof Error ? err.message : String(err)}`,
        isError: true
      };
    }
  }
};

export const rookCodePatchTool: AgentTool = {
  name: 'rook_code_patch',
  title: 'Atomic Source Code Patch',
  description: 'Applies precise search-and-replace code patches to files while maintaining whitespace, imports, and surrounding structure.',
  sideEffect: 'write',
  risk: 'medium',
  approval: 'policy',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to source file' },
      targetSubstring: { type: 'string', description: 'Exact existing code snippet to match' },
      replacement: { type: 'string', description: 'New code snippet to replace with' }
    },
    required: ['path', 'targetSubstring', 'replacement']
  },
  schema: z.object({
    path: z.string(),
    targetSubstring: z.string(),
    replacement: z.string()
  }),
  execute: async (input: { path: string; targetSubstring: string; replacement: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      globalRookKernel.fileEngine.setWorkspaceRoot(ctx.workspace);
      const res = await globalRookKernel.fileEngine.applyPatch(input.path, input.targetSubstring, input.replacement);

      if (!res.success) {
        return {
          content: `Patch application error: ${res.error}`,
          isError: true
        };
      }

      return {
        content: JSON.stringify({
          status: 'success',
          path: res.path,
          linesModified: res.linesModified
        }, null, 2)
      };
    } catch (err: unknown) {
      return {
        content: `Code patch exception: ${err instanceof Error ? err.message : String(err)}`,
        isError: true
      };
    }
  }
};

export const rookPermissionModeTool: AgentTool = {
  name: 'rook_permission_mode',
  title: 'Permission Regime Control',
  description: 'Inspects or switches the active permission regime between Plan (read-only), Build (interactive gates), and YOLO (autonomous).',
  sideEffect: 'none',
  risk: 'low',
  approval: 'never',
  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['plan', 'build', 'yolo'],
        description: 'New permission mode to set (omit to query current)'
      }
    }
  },
  schema: z.object({
    mode: z.enum(['plan', 'build', 'yolo']).optional()
  }),
  execute: async (input: { mode?: 'plan' | 'build' | 'yolo' }, ctx: ToolContext): Promise<ToolResult> => {
    if (input.mode) {
      globalRookKernel.setPermissionMode(input.mode);
    }
    return {
      content: JSON.stringify({
        activeRegime: globalRookKernel.getPermissionMode(),
        description: input.mode ? `Switched regime to ${input.mode}` : `Current active regime is ${globalRookKernel.getPermissionMode()}`
      }, null, 2)
    };
  }
};

export const rookTools: AgentTool[] = [
  rookVisualGroundTool,
  rookGuiActuateTool,
  rookCodePatchTool,
  rookPermissionModeTool
];
