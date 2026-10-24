import { ipcMain } from 'electron'
import {
  ENTERPRISE_CONTROL_IPC,
  type EnterpriseAuthorization,
  type EnterpriseControlMutation
} from '../../shared/enterpriseControl'
import { enterpriseControl } from './runtime'

/** Renderer access to the same native service used for mission admission. */
export function registerEnterpriseControlIpc(): void {
  ipcMain.handle(ENTERPRISE_CONTROL_IPC.snapshot, () => enterpriseControl().snapshot())
  ipcMain.handle(ENTERPRISE_CONTROL_IPC.mutate, (_event, mutation: EnterpriseControlMutation) =>
    enterpriseControl().mutate(mutation)
  )
  ipcMain.handle(ENTERPRISE_CONTROL_IPC.authorize, (_event, request: EnterpriseAuthorization) =>
    enterpriseControl().authorize(request)
  )
  ipcMain.handle(ENTERPRISE_CONTROL_IPC.revision, (_event, revision: unknown) => {
    if (!Number.isInteger(revision)) throw new Error('revision must be an integer.')
    return enterpriseControl().revision(revision as number)
  })
}
