import { describe, it, expect, beforeEach } from 'vitest';
import { PromeyKernel } from './promeyKernel';
import { PromeyMorningBriefEngine } from './morningBrief';
import { PromeyTriageEngine } from './triageEngine';
import { PromeyApprovalGate } from './approvalGate';
import { PromeyPrivacyGuard } from './privacyGuard';
import { PromeyRoutineWorker } from './routineWorker';
import { PromeyDuetProtocol } from './duetProtocol';

describe('Promey Proactive Duet Engine', () => {
  let kernel: PromeyKernel;

  beforeEach(() => {
    kernel = new PromeyKernel();
  });

  describe('Debranding Verification', () => {
    it('contains zero vendor branding traces in exports and generated tokens', () => {
      const kernelStatus = JSON.stringify(kernel.getStatus()).toLowerCase();
      expect(kernelStatus).not.toContain('copilotkit');
      expect(kernelStatus).not.toContain('open-duet');
      expect(kernelStatus).not.toContain('openduet');
      expect(kernelStatus).not.toContain('openbot');
    });
  });

  describe('Morning Brief Engine', () => {
    it('synthesizes a structured morning brief with high-priority items and approvals', () => {
      const briefEngine = new PromeyMorningBriefEngine();
      const brief = briefEngine.generateBrief({
        userName: 'Operator',
        workspaceName: 'SelfImpulse Core',
        triageItems: [
          {
            id: 't-1',
            source: 'git',
            title: 'Critical CVE patch required',
            content: 'Upgrade lodash dependency immediately',
            urgency: 'critical',
            category: 'action_required',
            status: 'action_required',
            receivedAt: new Date().toISOString()
          }
        ],
        pendingApprovals: [
          {
            id: 'app-1',
            actionType: 'deploy',
            title: 'Deploy to Staging',
            description: 'Deploy release 0.3.0',
            targetResource: 'staging.selfimpulse.internal',
            parameters: {},
            consequenceLevel: 'high',
            status: 'pending',
            requestedAt: new Date().toISOString()
          }
        ],
        routines: [
          {
            id: 'r-1',
            name: 'Security Sweep',
            cadence: 'hourly',
            standingPrompt: 'Check open ports',
            active: true
          }
        ],
        recentAccomplishments: ['RSIRALS 8-module substrate compiled cleanly']
      });

      expect(brief.headline).toContain('1 item(s) require your attention');
      expect(brief.summaryMarkdown).toContain('Critical CVE patch required');
      expect(brief.summaryMarkdown).toContain('Deploy to Staging');
      expect(brief.summaryMarkdown).toContain('Security Sweep');
      expect(brief.activeRoutinesCount).toBe(1);
    });
  });

  describe('Smart Triage Engine', () => {
    it('ingests and automatically elevates critical keywords to critical urgency', () => {
      const triage = new PromeyTriageEngine();
      const item = triage.ingestItem({
        source: 'system',
        title: 'Security vulnerability detected in token storage',
        content: 'Potential token leakage in auth cache'
      });

      expect(item.urgency).toBe('critical');
      expect(item.category).toBe('action_required');

      const resolved = triage.resolveItem(item.id, 'Patched vault encryption');
      expect(resolved).toBe(true);
      expect(triage.getTelemetry().resolvedCount).toBe(1);
    });
  });

  describe('Human-in-the-Loop Approval Gate (Tri-Choice)', () => {
    it('processes allow_once, always_allowed, and refused decisions correctly', () => {
      const gate = new PromeyApprovalGate();
      const req = gate.requestApproval({
        actionType: 'external_email',
        title: 'Send investor report',
        description: 'Send Q4 metrics to partners',
        targetResource: 'smtp://outbound.internal',
        consequenceLevel: 'high'
      });

      expect(req.autoApproved).toBe(false);
      expect(req.item.status).toBe('pending');

      // Decide always_allowed
      const decision = gate.submitDecision(req.item.id, 'always_allowed', 'Whitelisted for quarterly reporting');
      expect(decision.success).toBe(true);
      expect(decision.item?.status).toBe('always_allowed');

      // Subsequent identical request should now auto-approve
      const nextReq = gate.requestApproval({
        actionType: 'external_email',
        title: 'Send another email',
        description: 'Testing whitelist',
        targetResource: 'smtp://outbound.internal'
      });
      expect(nextReq.autoApproved).toBe(true);
      expect(nextReq.item.status).toBe('always_allowed');
    });
  });

  describe('Privacy Guard: Credential Masking & Outbound DLP', () => {
    it('masks sensitive secrets with opaque tokens so transcripts never see them', () => {
      const privacy = new PromeyPrivacyGuard();
      const rawSecret = 'super_secret_db_password_9981';
      const maskedToken = privacy.maskCredential(rawSecret, 'password');

      expect(maskedToken).toContain('__PROMEY_MASKED_PASSWORD_');
      expect(maskedToken).not.toContain(rawSecret);

      const unmasked = privacy.unmaskCredential(`connect --pass ${maskedToken}`);
      expect(unmasked).toBe(`connect --pass ${rawSecret}`);
    });

    it('scans and redacts API keys and payment cards in outbound messages', () => {
      const privacy = new PromeyPrivacyGuard();
      const outboundText = 'Here is the key sk-proj123456789012345678901234567890 and card 4532-1234-5678-9010';
      const result = privacy.sanitizeOutbound(outboundText);

      expect(result.sanitizedText).toContain('[REDACTED_OPENAI_SECRET_KEY]');
      expect(result.sanitizedText).toContain('[REDACTED_PAYMENT_CARD]');
      expect(result.redactedDlpCount).toBeGreaterThanOrEqual(2);
      expect(result.leaksPrevented).toContain('OpenAI Secret Key');
      expect(result.leaksPrevented).toContain('Payment Card Number');
    });
  });

  describe('Background Routine Worker', () => {
    it('manages standing routines and records execution telemetry', () => {
      const routines = new PromeyRoutineWorker();
      const newRoutine = routines.registerRoutine({
        name: 'Weekly Backup Audit',
        cadence: 'weekly',
        standingPrompt: 'Verify S3 cold storage replica integrity'
      });

      expect(newRoutine.active).toBe(true);
      routines.recordRun(newRoutine.id, 'Audit passed with 100% digest match');

      const updated = routines.listRoutines().find((r) => r.id === newRoutine.id);
      expect(updated?.lastOutcomeDigest).toContain('100% digest match');
      expect(routines.getTelemetry().totalExecutions).toBe(1);
    });
  });

  describe('Duet Protocol & Generative UI', () => {
    it('emits state deltas and supports mid-turn human interruptions and handback', () => {
      const protocol = new PromeyDuetProtocol();
      const delta1 = protocol.emitDelta('session-1', 'state_sync', { progress: 0.5 });
      expect(delta1.sequenceNumber).toBe(1);

      const interrupt = protocol.handleHumanInterrupt('session-1', 'Stop, switch to staging branch');
      expect(interrupt.eventType).toBe('human_interrupt');
      expect(interrupt.payload.instructions).toBe('Stop, switch to staging branch');

      const handback = protocol.handbackToAgent('session-1', { branch: 'staging' });
      expect(handback.eventType).toBe('handback');
      expect(handback.sequenceNumber).toBe(3);

      const widget = protocol.emitGenerativeUi({
        type: 'approval_card',
        title: 'Review Change',
        data: { diff: '+5 lines' }
      });
      expect(widget.widgetId).toContain('genui-');
    });
  });

  describe('Promey Master Kernel Coordination', () => {
    it('orchestrates end-to-end proactive brief and consequential approval', () => {
      const brief = kernel.generateMorningBrief('Operator', 'Workspace');
      expect(brief.briefId).toBeDefined();

      const approval = kernel.requestConsequentialApproval({
        actionType: 'rmdir',
        title: 'Remove legacy build output',
        description: 'Purge old dist folder',
        targetResource: 'D:/selfimpulse/dist',
        consequenceLevel: 'medium'
      });
      expect(approval.item.status).toBe('pending');

      const status = kernel.getStatus();
      expect(status.ready).toBe(true);
      expect(status.latestBrief).toBeDefined();
    });
  });
});
