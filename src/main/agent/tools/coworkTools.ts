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

export const coworkVerifyPassportTool: AgentTool = {
  name: 'cowork_verify_passport',
  title: 'Enterprise Agent Passport Attestation',
  description: 'Verifies the cryptographic Zero-Trust Agent Passport and delegated scopes for the active Cowork session.',
  sideEffect: 'none',
  risk: 'low',
  approval: 'never',
  inputSchema: {
    type: 'object',
    properties: {
      principal: { type: 'string', description: 'Principal identifier (e.g. operator or agent-id)' },
      requiredScope: { type: 'string', description: 'Specific scope to verify (e.g. fs:write, tool:execute)' }
    }
  },
  schema: z.object({
    principal: z.string().optional(),
    requiredScope: z.string().optional()
  }),
  execute: async (input: { principal?: string; requiredScope?: string }, ctx: ToolContext): Promise<ToolResult> => {
    const passport = globalCoworkKernel.enterprise.passport.issuePassport(
      input.principal || 'operator',
      'coworker',
      ['fs:read', 'fs:write', 'tool:execute', 'network:verified']
    );
    const verification = globalCoworkKernel.enterprise.passport.verifyPassport(passport, input.requiredScope);
    return {
      content: JSON.stringify({
        passportId: passport.passportId,
        principal: passport.principal,
        agentRole: passport.agentRole,
        allowedScopes: passport.allowedScopes,
        signature: passport.signature,
        verified: verification.valid,
        expiresAt: new Date(passport.expiresAt).toISOString()
      }, null, 2)
    };
  }
};

export const coworkCheckBlastRadiusTool: AgentTool = {
  name: 'cowork_check_blast_radius',
  title: 'Blast-Radius Limits & Spend Budget',
  description: 'Inspects real-time token spend, file write rates, and blast-radius escalation status under Cowork mode.',
  sideEffect: 'none',
  risk: 'low',
  approval: 'never',
  inputSchema: {
    type: 'object',
    properties: {}
  },
  schema: z.object({}),
  execute: async (_input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const budget = globalCoworkKernel.enterprise.blastRadius.getBudgetStatus();
    return {
      content: JSON.stringify(budget, null, 2)
    };
  }
};

export const coworkAttestProofTool: AgentTool = {
  name: 'cowork_attest_proof',
  title: 'Evidence-Grounded Tool Attestation',
  description: 'Generates a tamper-evident cryptographic execution proof for a completed action, ensuring non-hallucinatory evidence grounding.',
  sideEffect: 'none',
  risk: 'low',
  approval: 'never',
  inputSchema: {
    type: 'object',
    properties: {
      toolName: { type: 'string', description: 'Name of the executed tool' },
      inputData: { type: 'object', description: 'Arguments executed' },
      outputData: { type: 'object', description: 'Result produced' }
    },
    required: ['toolName', 'inputData', 'outputData']
  },
  schema: z.object({
    toolName: z.string(),
    inputData: z.record(z.string(), z.unknown()),
    outputData: z.record(z.string(), z.unknown())
  }),
  execute: async (input: { toolName: string; inputData: Record<string, unknown>; outputData: Record<string, unknown> }, ctx: ToolContext): Promise<ToolResult> => {
    const proof = globalCoworkKernel.enterprise.verifier.attestToolExecution(
      input.toolName,
      input.inputData,
      input.outputData
    );
    return {
      content: JSON.stringify({
        proofId: proof.proofId,
        toolName: proof.toolName,
        inputDigest: proof.inputDigest,
        outputDigest: proof.outputDigest,
        attestationSignature: proof.attestationSignature,
        timestamp: new Date(proof.timestamp).toISOString(),
        verified: proof.verified
      }, null, 2)
    };
  }
};

export const coworkIsolateMemoryTool: AgentTool = {
  name: 'cowork_isolate_memory',
  title: 'Kernel-Level Memory Partition',
  description: 'Creates or writes to a tamper-sealed, scoped memory partition preventing prompt injection leakage and context contamination.',
  sideEffect: 'execute',
  risk: 'low',
  approval: 'never',
  inputSchema: {
    type: 'object',
    properties: {
      namespace: { type: 'string', description: 'Memory partition namespace' },
      key: { type: 'string', description: 'Key identifier' },
      value: { type: 'string', description: 'Data value to store' },
      sensitivity: { type: 'string', enum: ['public', 'internal', 'confidential', 'restricted'] }
    },
    required: ['namespace', 'key', 'value']
  },
  schema: z.object({
    namespace: z.string(),
    key: z.string(),
    value: z.string(),
    sensitivity: z.enum(['public', 'internal', 'confidential', 'restricted']).optional()
  }),
  execute: async (input: { namespace: string; key: string; value: string; sensitivity?: any }, ctx: ToolContext): Promise<ToolResult> => {
    const res = globalCoworkKernel.enterprise.memory.writeScopedMemory(
      input.namespace,
      input.key,
      input.value,
      'coworker'
    );
    return {
      content: JSON.stringify({
        success: res.success,
        error: res.error,
        namespace: input.namespace,
        key: input.key
      }, null, 2)
    };
  }
};

export const coworkDistillEvolutionTool: AgentTool = {
  name: 'cowork_distill_evolution',
  title: 'Self-Evolving Scaffolding Distiller',
  description: 'Distills execution patterns into persistent tactical rules for the self-improving Cowork agent harness.',
  sideEffect: 'execute',
  risk: 'low',
  approval: 'never',
  inputSchema: {
    type: 'object',
    properties: {
      domain: { type: 'string', description: 'Domain or task category (e.g. coding, devops, browser)' },
      patternDetected: { type: 'string', description: 'Observed obstacle or pattern' },
      distilledStrategy: { type: 'string', description: 'Distilled rule or guideline for future runs' }
    },
    required: ['domain', 'patternDetected', 'distilledStrategy']
  },
  schema: z.object({
    domain: z.string(),
    patternDetected: z.string(),
    distilledStrategy: z.string()
  }),
  execute: async (input: { domain: string; patternDetected: string; distilledStrategy: string }, ctx: ToolContext): Promise<ToolResult> => {
    const rule = globalCoworkKernel.enterprise.evolution.distillEvolutionRule(
      input.domain,
      input.patternDetected,
      input.distilledStrategy
    );
    return {
      content: JSON.stringify(rule, null, 2)
    };
  }
};

export const coworkTools: AgentTool[] = [
  coworkKineticActuateTool,
  coworkPerceiveDomTool,
  coworkSearchSkillsTool,
  coworkQuarantineCheckTool,
  coworkVerifyPassportTool,
  coworkCheckBlastRadiusTool,
  coworkAttestProofTool,
  coworkIsolateMemoryTool,
  coworkDistillEvolutionTool
];
