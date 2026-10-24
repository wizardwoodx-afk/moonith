import { ipcMain } from 'electron'
import { RSIRALS_IPC } from '../../../shared/rsirals'
import { rsiralsSnapshot } from './rsiralsSnapshot'

export function registerRsiralsIpc(): void {
  ipcMain.handle(RSIRALS_IPC.snapshot, () => rsiralsSnapshot())
}
