import { describe, it, expect } from 'vitest'
import {
  DisplayMatrix,
  KineticActuator,
  DomMatrix,
  SurfaceStreamer,
  PolicyArbiter,
  LobeSkillRegistry,
  CoworkKernel
} from './index'

describe('Cowork Subsystem in SelfImpulse', () => {
  it('generates natural bezier trajectory and denormalizes coordinates', async () => {
    const display = new DisplayMatrix();
    const actuator = new KineticActuator(display);

    const traj = actuator.generateTrajectory({
      startX: 0,
      startY: 0,
      targetX: 500,
      targetY: 500,
      curvature: 0.1,
      durationMs: 150,
      easingCurve: 'natural_bezier'
    }, 10);

    expect(traj.length).toBe(11);
    expect(traj[0].x).toBe(0);
    expect(traj[10].x).toBe(500);

    const res = await actuator.dispatchKineticEvent({
      kind: 'click',
      coordinates: { x: 0.5, y: 0.5, normalized: true }
    });
    expect(res.success).toBe(true);
    expect(actuator.getCurrentCoordinates().x).toBe(960);
    expect(actuator.getCurrentCoordinates().y).toBe(540);
  });

  it('locates elements in perception snapshot by intent', () => {
    const matrix = new DomMatrix();
    const snapshot = matrix.parseDomHierarchy([
      {
        tag: 'button',
        accessibleName: 'Save Settings',
        role: 'button',
        rect: { x: 50, y: 50, width: 120, height: 36 },
        interactive: true
      }
    ]);

    expect(snapshot.domTree.length).toBe(1);
    const found = matrix.locateElementByIntent(snapshot, 'Save Settings');
    expect(found).not.toBeNull();
    expect(found?.accessibleName).toBe('Save Settings');
  });

  it('enforces fail-closed security assertions', () => {
    const arbiter = new PolicyArbiter();

    const allowed = arbiter.evaluateAction('tool', 'read_document', { docId: '123' });
    expect(allowed.allowed).toBe(true);

    const credentialDenied = arbiter.evaluateAction('tool', 'dump_secrets', { key: 'SECRET_API_TOKEN' });
    expect(credentialDenied.allowed).toBe(false);
    expect(credentialDenied.requiresHumanApproval).toBe(true);

    const destructiveDenied = arbiter.evaluateAction('tool', 'exec', { cmd: 'rm -rf /' });
    expect(destructiveDenied.allowed).toBe(false);
    expect(destructiveDenied.requiresHumanApproval).toBe(false);
  });

  it('loads LobeSkillRegistry with marketplace and builtin skills', () => {
    const registry = new LobeSkillRegistry();
    const total = registry.getTotalSkillCount();
    expect(total).toBeGreaterThanOrEqual(4);

    const searchRes = registry.searchSkills('code', 5);
    expect(searchRes.length).toBeGreaterThan(0);

    const schema = registry.resolveToolSchema('skill_builtin_code_interpreter');
    expect(schema).not.toBeNull();
  });

  it('detects cyclical execution loops with DivergenceGuard', async () => {
    const kernel = new CoworkKernel({ sessionId: 'vitest_session' });

    await kernel.executeStep('tool', 'query', { param: 'alpha' });
    await kernel.executeStep('tool', 'query', { param: 'alpha' });
    await kernel.executeStep('tool', 'query', { param: 'alpha' });
    const finalStep = await kernel.executeStep('tool', 'query', { param: 'alpha' });

    expect(finalStep.error).toContain('DivergenceGuard');
    expect(kernel.getStatus()).toBe('faulted');
  });
});
