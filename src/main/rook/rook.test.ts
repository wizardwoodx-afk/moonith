import { describe, it, expect } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs/promises'
import {
  VisualGroundingEngine,
  GuiActionSpace,
  CodeFileEngine,
  PermissionRegimeManager,
  ExecutionPlanner,
  RookKernel
} from './index'
import { rookEngineBridge } from '../engine/rookBridge'

describe('ROOK Subsystem in SelfImpulse', () => {
  it('translates normalized [0, 1000] bounding boxes to physical screen coordinates', () => {
    const engine = new VisualGroundingEngine({ width: 1920, height: 1080 });
    const box = { ymin: 450, xmin: 400, ymax: 550, xmax: 600 };
    const physical = engine.denormalizeBox(box);

    expect(physical.left).toBe(768);
    expect(physical.top).toBe(486);
    expect(physical.width).toBe(384);
    expect(physical.height).toBe(108);

    const center = engine.getCenterPoint(box);
    expect(center.x).toBe(960);
    expect(center.y).toBe(540);
  });

  it('plans smooth natural bezier trajectory and simulates mouse actuation', async () => {
    const actionSpace = new GuiActionSpace();
    const trajectory = actionSpace.planTrajectory({ x: 0, y: 0 }, { x: 500, y: 500 }, 10);

    expect(trajectory.length).toBe(11);
    expect(trajectory[0].x).toBe(0);
    expect(trajectory[10].x).toBe(500);

    const res = await actionSpace.executeGuiAction({
      action: 'click',
      coordinates: { x: 800, y: 400 }
    });

    expect(res.success).toBe(true);
    expect(actionSpace.getCursorPosition().x).toBe(800);
    expect(actionSpace.getCursorPosition().y).toBe(400);
  });

  it('performs atomic file writes and targeted search-and-replace patches', async () => {
    const tmpDir = path.join(os.tmpdir(), `rook-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    try {
      const fileEngine = new CodeFileEngine(tmpDir);
      const testFile = 'example.ts';

      const writeRes = await fileEngine.writeFile(testFile, 'export function run() {\n  const x = 1;\n  return x;\n}');
      expect(writeRes.success).toBe(true);

      const patchRes = await fileEngine.applyPatch(testFile, 'const x = 1;', 'const x = 42;');
      expect(patchRes.success).toBe(true);

      const readRes = await fileEngine.readFile(testFile);
      expect(readRes.content).toContain('const x = 42;');
      expect(readRes.content).not.toContain('const x = 1;');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('enforces permission regimes across Plan, Build, and YOLO modes', () => {
    const perms = new PermissionRegimeManager('plan');

    // In plan mode, write actions are denied
    const writeCheck = perms.evaluateAction('code_terminal', 'write', { path: 'test.ts' });
    expect(writeCheck.allowed).toBe(false);

    // In plan mode, read actions are allowed
    const readCheck = perms.evaluateAction('code_terminal', 'read', { path: 'test.ts' });
    expect(readCheck.allowed).toBe(true);

    // Switch to build mode
    perms.setMode('build');
    const buildWriteCheck = perms.evaluateAction('code_terminal', 'write', { path: 'test.ts' });
    expect(buildWriteCheck.allowed).toBe(true);

    // Switch to YOLO mode
    perms.setMode('yolo');
    const yoloExecCheck = perms.evaluateAction('code_terminal', 'shell', { cmd: 'npm test' });
    expect(yoloExecCheck.allowed).toBe(true);
  });

  it('decomposes complex goals into dual-modality execution steps', () => {
    const steps = ExecutionPlanner.decomposeTask('Inspect visual button and refactor configuration code');
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.some(s => s.modality === 'gui_vision')).toBe(true);
    expect(steps.some(s => s.modality === 'code_terminal')).toBe(true);
  });

  it('executes end-to-end turns through RookKernel and RookEngineBridge', async () => {
    const bridge = rookEngineBridge;
    expect(bridge.getStatus().ready).toBe(true);

    const visualTurn = await bridge.executeVisualAction({
      action: 'click',
      coordinates: { x: 300, y: 150 }
    });
    expect(visualTurn.output?.success).toBe(true);
    expect(visualTurn.modality).toBe('gui_vision');

    const kernel = new RookKernel();
    kernel.setPermissionMode('yolo');
    const shellTurn = await kernel.executeShell('node -v');
    expect(shellTurn.output?.exitCode).toBe(0);
    expect(typeof shellTurn.output?.stdout).toBe('string');
  });
});
