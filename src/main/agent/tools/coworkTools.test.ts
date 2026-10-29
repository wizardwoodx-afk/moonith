import { describe, it, expect } from 'vitest'
import {
  coworkKineticActuateTool,
  coworkPerceiveDomTool,
  coworkSearchSkillsTool,
  coworkQuarantineCheckTool,
  coworkTools
} from './coworkTools'
import { getBuiltinTools } from './index'

describe('Cowork Agent Tools in SelfImpulse', () => {
  const dummyCtx: any = {
    task: { id: 't1', mode: 'cowork' },
    workspace: '/tmp',
    roots: ['/tmp'],
    allowShell: true,
    addArtifact: async () => null,
    setBrowser: () => {},
    setPlan: () => {},
    toast: () => {}
  };

  it('exports all 9 cowork tools and integrates into getBuiltinTools', () => {
    expect(coworkTools.length).toBe(9);

    const taskTools = getBuiltinTools('cowork');
    expect(taskTools.some(t => t.name === 'cowork_kinetic_actuate')).toBe(true);
    expect(taskTools.some(t => t.name === 'cowork_perceive_dom')).toBe(true);
    expect(taskTools.some(t => t.name === 'cowork_search_skills')).toBe(true);
    expect(taskTools.some(t => t.name === 'cowork_quarantine_check')).toBe(true);

    const chatTools = getBuiltinTools('chat');
    expect(chatTools.some(t => t.name === 'cowork_search_skills')).toBe(true);
    expect(chatTools.some(t => t.name === 'cowork_perceive_dom')).toBe(true);
  });

  it('executes cowork_kinetic_actuate successfully', async () => {
    const res = await coworkKineticActuateTool.execute(
      {
        action: 'click',
        coordinates: { x: 100, y: 200, normalized: false }
      },
      dummyCtx
    );

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content);
    expect(parsed.status).toBe('success');
    expect(parsed.currentCursor.x).toBe(100);
    expect(parsed.currentCursor.y).toBe(200);
  });

  it('executes cowork_perceive_dom and locates targets', async () => {
    const res = await coworkPerceiveDomTool.execute(
      {
        queryIntent: 'Execute Task'
      },
      dummyCtx
    );

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content);
    expect(parsed.totalNodes).toBeGreaterThan(0);
    expect(parsed.locatedElement.accessibleName).toBe('Execute Task');
  });

  it('executes cowork_search_skills over the catalog', async () => {
    const res = await coworkSearchSkillsTool.execute(
      {
        query: 'code',
        limit: 5
      },
      dummyCtx
    );

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content);
    expect(parsed.matchesFound).toBeGreaterThan(0);
    expect(parsed.skills[0].toolSchema).toBeDefined();
  });

  it('executes cowork_quarantine_check for security evaluation', async () => {
    const safeRes = await coworkQuarantineCheckTool.execute(
      {
        modality: 'tool',
        actionName: 'list_directory',
        payload: { path: '.' }
      },
      dummyCtx
    );

    const safeParsed = JSON.parse(safeRes.content);
    expect(safeParsed.allowed).toBe(true);

    const riskRes = await coworkQuarantineCheckTool.execute(
      {
        modality: 'tool',
        actionName: 'exec',
        payload: { cmd: 'rm -rf /' }
      },
      dummyCtx
    );

    const riskParsed = JSON.parse(riskRes.content);
    expect(riskParsed.allowed).toBe(false);
    expect(riskParsed.reason).toContain('Denied by rule');
  });
});
