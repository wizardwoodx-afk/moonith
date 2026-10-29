/**
 * PROPRIETARY - SelfImpulse Promey Native Agent Tools
 * Exposes Promey's Proactive Duet & HITL capabilities to the agent runtime.
 */

import { promeyEngineBridge } from '../../engine/promeyBridge';
import type { AgentTool } from './types';

export const promeyGenerateBriefTool: AgentTool = {
  name: 'promey_generate_brief',
  description: 'Generate an executive proactive morning brief summarizing triage streams, pending approvals, and standing routines.',
  parameters: {
    type: 'object',
    properties: {
      userName: { type: 'string', description: 'Operator or user display name' },
      workspaceName: { type: 'string', description: 'Current workspace or project name' }
    }
  },
  execute: async (args) => {
    const userName = typeof args.userName === 'string' ? args.userName : undefined;
    const workspaceName = typeof args.workspaceName === 'string' ? args.workspaceName : undefined;

    const brief = promeyEngineBridge.generateMorningBrief(userName, workspaceName);

    return {
      status: 'generated',
      briefId: brief.briefId,
      date: brief.date,
      headline: brief.headline,
      summaryMarkdown: brief.summaryMarkdown,
      highPriorityCount: brief.highPriorityItems.length,
      pendingApprovalsCount: brief.pendingApprovals.length
    };
  }
};

export const promeyTriageStreamTool: AgentTool = {
  name: 'promey_triage_stream',
  description: 'Ingest and prioritize an incoming item or event into the Promey Smart Triage stream.',
  parameters: {
    type: 'object',
    properties: {
      source: { 
        type: 'string', 
        enum: ['workspace', 'git', 'communications', 'calendar', 'system', 'custom'],
        description: 'Originating source of the item' 
      },
      title: { type: 'string', description: 'Brief summary title' },
      content: { type: 'string', description: 'Detailed item content or event description' },
      urgency: { 
        type: 'string', 
        enum: ['critical', 'high', 'normal', 'low'],
        description: 'Urgency tier' 
      },
      category: {
        type: 'string',
        enum: ['action_required', 'review_needed', 'informational', 'background_work']
      }
    },
    required: ['source', 'title', 'content']
  },
  execute: async (args) => {
    const item = promeyEngineBridge.triageStream({
      source: (args.source as any) || 'custom',
      title: String(args.title),
      content: String(args.content),
      urgency: (args.urgency as any) || 'normal',
      category: (args.category as any) || 'action_required'
    });

    return {
      status: 'triaged',
      itemId: item.id,
      urgency: item.urgency,
      category: item.category,
      receivedAt: item.receivedAt
    };
  }
};

export const promeyRequestApprovalTool: AgentTool = {
  name: 'promey_request_approval',
  description: 'Request Human-in-the-Loop approval for a consequential action (Allow Once / Always Allow / Refuse).',
  parameters: {
    type: 'object',
    properties: {
      actionType: { type: 'string', description: 'Type of action (e.g., deploy, external_email, delete_records)' },
      title: { type: 'string', description: 'Human-friendly title for the approval' },
      description: { type: 'string', description: 'Clear explanation of what will happen' },
      targetResource: { type: 'string', description: 'Target system, file, or endpoint' },
      consequenceLevel: { 
        type: 'string', 
        enum: ['low', 'medium', 'high', 'critical'],
        description: 'Severity level' 
      },
      parameters: { type: 'object', description: 'Parameters to execute upon approval' }
    },
    required: ['actionType', 'title', 'description', 'targetResource']
  },
  execute: async (args) => {
    const req = promeyEngineBridge.requestApproval({
      actionType: String(args.actionType),
      title: String(args.title),
      description: String(args.description),
      targetResource: String(args.targetResource),
      consequenceLevel: (args.consequenceLevel as any) || 'medium',
      parameters: typeof args.parameters === 'object' && args.parameters !== null 
        ? (args.parameters as Record<string, unknown>) 
        : {}
    });

    return {
      status: req.autoApproved ? 'auto_approved' : (req.autoRefused ? 'auto_refused' : 'pending_user_decision'),
      approvalId: req.item.id,
      consequenceLevel: req.item.consequenceLevel,
      allowed: req.autoApproved
    };
  }
};

export const promeyMaskCredentialTool: AgentTool = {
  name: 'promey_mask_credentials',
  description: 'Mask sensitive passwords, secrets, or API tokens with opaque tokens so they never leak into model transcripts.',
  parameters: {
    type: 'object',
    properties: {
      secretValue: { type: 'string', description: 'The sensitive string to protect' },
      label: { type: 'string', description: 'Optional label (e.g. password, apikey)' }
    },
    required: ['secretValue']
  },
  execute: async (args) => {
    const secretValue = String(args.secretValue);
    const label = typeof args.label === 'string' ? args.label : 'secret';
    const maskedToken = promeyEngineBridge.maskSecret(secretValue, label);

    return {
      status: 'masked',
      maskedToken,
      safeForTranscript: true
    };
  }
};

export const promeyScanDlpTool: AgentTool = {
  name: 'promey_scan_dlp',
  description: 'Scan outbound text for accidental API key, private key, or payment card leaks.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text payload to scan before transmission' }
    },
    required: ['text']
  },
  execute: async (args) => {
    const text = String(args.text);
    const result = promeyEngineBridge.sanitizeOutbound(text);

    return {
      status: 'scanned',
      sanitizedText: result.sanitizedText,
      redactedDlpCount: result.redactedDlpCount,
      leaksPrevented: result.leaksPrevented
    };
  }
};

export const promeyScheduleRoutineTool: AgentTool = {
  name: 'promey_schedule_routine',
  description: 'Register an autonomous standing instruction or background routine in Promey.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the routine' },
      cadence: { type: 'string', description: 'Cadence (e.g., hourly, daily_morning, daily_evening)' },
      standingPrompt: { type: 'string', description: 'Exact prompt instructions to run autonomously' }
    },
    required: ['name', 'cadence', 'standingPrompt']
  },
  execute: async (args) => {
    const routine = promeyEngineBridge.getKernel().routines.registerRoutine({
      name: String(args.name),
      cadence: String(args.cadence),
      standingPrompt: String(args.standingPrompt)
    });

    return {
      status: 'scheduled',
      routineId: routine.id,
      name: routine.name,
      cadence: routine.cadence,
      active: routine.active
    };
  }
};

export const promeyStreamGenerativeUiTool: AgentTool = {
  name: 'promey_stream_generative_ui',
  description: 'Emit an event-driven Generative UI widget (approval card, status pill, triage card) directly to the user interface.',
  parameters: {
    type: 'object',
    properties: {
      type: { 
        type: 'string', 
        enum: ['approval_card', 'triage_list', 'brief_summary', 'status_pill', 'diff_preview'],
        description: 'Widget type' 
      },
      title: { type: 'string', description: 'Widget title' },
      data: { type: 'object', description: 'Structured widget data' }
    },
    required: ['type', 'title', 'data']
  },
  execute: async (args) => {
    const widget = promeyEngineBridge.getKernel().protocol.emitGenerativeUi({
      type: (args.type as any) || 'status_pill',
      title: String(args.title),
      data: typeof args.data === 'object' && args.data !== null ? (args.data as Record<string, unknown>) : {}
    });

    return {
      status: 'emitted',
      widgetId: widget.widgetId,
      type: widget.type,
      title: widget.title
    };
  }
};

export const promeyTools: AgentTool[] = [
  promeyGenerateBriefTool,
  promeyTriageStreamTool,
  promeyRequestApprovalTool,
  promeyMaskCredentialTool,
  promeyScanDlpTool,
  promeyScheduleRoutineTool,
  promeyStreamGenerativeUiTool
];
