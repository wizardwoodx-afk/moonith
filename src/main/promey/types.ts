/**
 * PROPRIETARY - SelfImpulse Promey Duet Engine
 * Debranded & Enhanced Proactive Autonomous Assistant Substrate
 */

export type ConsequenceLevel = 'low' | 'medium' | 'high' | 'critical';

export type ApprovalDecision = 'allow_once' | 'always_allowed' | 'refused';

export interface PromeyApprovalItem {
  id: string;
  actionType: string;
  title: string;
  description: string;
  targetResource: string;
  parameters: Record<string, unknown>;
  consequenceLevel: ConsequenceLevel;
  status: 'pending' | ApprovalDecision;
  requestedAt: string;
  decidedAt?: string;
  decisionNote?: string;
}

export interface PromeyTriageItem {
  id: string;
  source: 'workspace' | 'git' | 'communications' | 'calendar' | 'system' | 'custom';
  title: string;
  content: string;
  urgency: 'critical' | 'high' | 'normal' | 'low';
  category: 'action_required' | 'review_needed' | 'informational' | 'background_work';
  suggestedAction?: string;
  status: 'unread' | 'action_required' | 'resolved' | 'dismissed';
  receivedAt: string;
}

export interface PromeyMorningBrief {
  briefId: string;
  date: string;
  headline: string;
  summaryMarkdown: string;
  highPriorityItems: PromeyTriageItem[];
  pendingApprovals: PromeyApprovalItem[];
  activeRoutinesCount: number;
  generatedAt: string;
}

export interface PromeyStandingRoutine {
  id: string;
  name: string;
  cadence: 'hourly' | 'daily_morning' | 'daily_evening' | 'weekly' | string;
  standingPrompt: string;
  active: boolean;
  lastRunAt?: string;
  lastOutcomeDigest?: string;
}

export interface PromeyDuetStateDelta {
  sessionId: string;
  sequenceNumber: number;
  eventType: 'state_sync' | 'action_proposed' | 'generative_ui' | 'human_interrupt' | 'handback';
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface PromeyGenerativeUiWidget {
  widgetId: string;
  type: 'approval_card' | 'triage_list' | 'brief_summary' | 'status_pill' | 'diff_preview';
  title: string;
  data: Record<string, unknown>;
  actionOptions?: Array<{ label: string; actionId: string; style?: 'primary' | 'danger' | 'ghost' }>;
}

export interface PromeyPrivacySanitizeResult {
  sanitizedText: string;
  maskedCredentialsCount: number;
  redactedDlpCount: number;
  leaksPrevented: string[];
}
