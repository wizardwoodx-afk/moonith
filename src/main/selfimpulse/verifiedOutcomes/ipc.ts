import { ipcMain } from 'electron'
import {
  VERIFIED_OUTCOMES_IPC,
  type VerifiedOutcomeMutation
} from '../../../shared/verifiedOutcomes'
import { verifiedOutcomes } from './runtime'

/** Snapshot plus local-owner administration; no agent promotion endpoint exists. */
export function registerVerifiedOutcomesIpc(): void {
  ipcMain.handle(VERIFIED_OUTCOMES_IPC.snapshot, () => verifiedOutcomes().snapshot())
  ipcMain.handle(VERIFIED_OUTCOMES_IPC.mutate, (_event, mutation: VerifiedOutcomeMutation) =>
    verifiedOutcomes().mutate(mutation)
  )
}
