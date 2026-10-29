import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  DEFAULT_NAMESPACE_ID,
  ENTERPRISE_CONTROL_IPC,
  LOCAL_OWNER_PRINCIPAL_ID,
  type EnterpriseAuthorization,
  type EnterpriseControlMutation
} from '../../shared/enterpriseControl'
import { assertTrustedMainFrame } from '../ipcTrust'
import { enterpriseControl, requireLocalEnterprise } from './runtime'

/** Renderer access to the same native service used for mission admission. */
export function registerEnterpriseControlIpc(): void {
  ipcMain.handle(ENTERPRISE_CONTROL_IPC.snapshot, (event) => {
    assertTrustedMainFrame(event)
    return enterpriseControl().snapshot()
  })
  ipcMain.handle(
    ENTERPRISE_CONTROL_IPC.mutate,
    async (event: IpcMainInvokeEvent, mutation: EnterpriseControlMutation) => {
      assertTrustedMainFrame(event)
      await requireLocalEnterprise('enterprise.manage', 'namespace', DEFAULT_NAMESPACE_ID)
      return enterpriseControl().mutate(mutation)
    }
  )
  ipcMain.handle(
    ENTERPRISE_CONTROL_IPC.authorize,
    (event: IpcMainInvokeEvent, request: EnterpriseAuthorization) => {
      assertTrustedMainFrame(event)
      if (!request || request.principalId !== LOCAL_OWNER_PRINCIPAL_ID) {
        throw new Error('Renderer control-plane requests are pinned to the local owner.')
      }
      return enterpriseControl().authorize(request)
    }
  )
  ipcMain.handle(ENTERPRISE_CONTROL_IPC.revision, (event: IpcMainInvokeEvent, revision: unknown) => {
    assertTrustedMainFrame(event)
    if (!Number.isInteger(revision)) throw new Error('revision must be an integer.')
    return enterpriseControl().revision(revision as number)
  })
}
