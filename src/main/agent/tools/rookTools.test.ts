import { describe, it, expect } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs/promises'
import {
  rookVisualGroundTool,
  rookGuiActuateTool,
  rookCodePatchTool,
  rookPermissionModeTool,
  rookTools
} from './rookTools'
import { getBuiltinTools } from './index'

describe('ROOK Agent Tools in SelfImpulse', () => {
  const dummyCtx: any = {
    task: { id: 't_rook', mode: 'cowork' },
    workspace: os.tmpdir(),
    roots: [os.tmpdir()],
    allowShell: true,
    addArtifact: async () => null,
    setBrowser: () => {},
    setPlan: () => {},
    toast: () => {}
  };

  it('exports all 4 ROOK tools and registers them into getBuiltinTools', () => {
    expect(rookTools.length).toBe(4);

    const builtinTaskTools = getBuiltinTools('cowork');
    expect(builtinTaskTools.some(t => t.name === 'rook_visual_ground')).toBe(true);
    expect(builtinTaskTools.some(t => t.name === 'rook_gui_actuate')).toBe(true);
    expect(builtinTaskTools.some(t => t.name === 'rook_code_patch')).toBe(true);
    expect(builtinTaskTools.some(t => t.name === 'rook_permission_mode')).toBe(true);

    const builtinChatTools = getBuiltinTools('chat');
    expect(builtinChatTools.some(t => t.name === 'rook_visual_ground')).toBe(true);
    expect(builtinChatTools.some(t => t.name === 'rook_permission_mode')).toBe(true);
  });

  it('executes rook_visual_grounding with exact pixel translation', async () => {
    const res = await rookVisualGroundTool.execute(
      {
        box: { ymin: 200, xmin: 100, ymax: 600, xmax: 500 }
      },
      dummyCtx
    );

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content);
    expect(parsed.status).toBe('success');
    expect(parsed.physicalBounds.width).toBeGreaterThan(0);
    expect(parsed.centerCoordinates.x).toBeGreaterThan(0);
  });

  it('executes rook_gui_actuate smoothly', async () => {
    const res = await rookGuiActuateTool.execute(
      {
        action: 'click',
        coordinates: { x: 450, y: 350 }
      },
      dummyCtx
    );

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content);
    expect(parsed.status).toBe('success');
    expect(parsed.executedAction).toBe('click');
  });

  it('executes rook_permission_mode querying and toggling', async () => {
    // Switch to yolo
    const resSwitch = await rookPermissionModeTool.execute(
      { mode: 'yolo' },
      dummyCtx
    );
    expect(resSwitch.isError).toBeFalsy();
    const parsedSwitch = JSON.parse(resSwitch.content);
    expect(parsedSwitch.activeRegime).toBe('yolo');

    // Query active
    const resQuery = await rookPermissionModeTool.execute({}, dummyCtx);
    const parsedQuery = JSON.parse(resQuery.content);
    expect(parsedQuery.activeRegime).toBe('yolo');
  });

  it('executes rook_code_patch applying targeted modifications', async () => {
    const testDir = path.join(os.tmpdir(), `rook-tool-patch-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    const filePath = 'service.ts';
    await fs.writeFile(path.join(testDir, filePath), 'const port = 3000;\napp.listen(port);', 'utf-8');

    const patchCtx: any = {
      ...dummyCtx,
      workspace: testDir,
      roots: [testDir]
    };

    try {
      const res = await rookCodePatchTool.execute(
        {
          path: filePath,
          targetSubstring: 'const port = 3000;',
          replacement: 'const port = 8080;'
        },
        patchCtx
      );

      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content);
      expect(parsed.status).toBe('success');

      const fileContent = await fs.readFile(path.join(testDir, filePath), 'utf-8');
      expect(fileContent).toContain('const port = 8080;');
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });
});
