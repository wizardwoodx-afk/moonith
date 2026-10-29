import { ipcMain } from 'electron';
import { RSIRALS_IPC } from '../../../shared/rsirals';
import { rsiralsSnapshot } from './rsiralsSnapshot';
import { RsiralsEngine } from '../rsirals/rsiralsEngine';

export function registerRsiralsIpc(): void {
  const engine = RsiralsEngine.getInstance();

  ipcMain.handle(RSIRALS_IPC.snapshot, () => rsiralsSnapshot());

  ipcMain.handle(RSIRALS_IPC.octaStatus, () => engine.getOctaStatus());

  ipcMain.handle(RSIRALS_IPC.executeFastLoop, (_event, action, context) => 
    engine.executeFastLoopAction(action, context)
  );

  ipcMain.handle(RSIRALS_IPC.diagnoseFailure, (_event, trace, failure) => 
    engine.diagnoseEpisodeFailure(trace, failure)
  );

  ipcMain.handle(RSIRALS_IPC.induceSkill, (_event, req) => 
    engine.induceSkill(req)
  );

  ipcMain.handle(RSIRALS_IPC.publishClaim, (_event, params) => 
    engine.publishVerifiedClaim(params)
  );

  ipcMain.handle(RSIRALS_IPC.acquireCharter, (_event, params) => 
    engine.acquireTaskCharter(params)
  );

  ipcMain.handle(RSIRALS_IPC.metaEvolve, (_event, candidate, evidence) => 
    engine.evaluateMetaEvolution(candidate, evidence)
  );
}
