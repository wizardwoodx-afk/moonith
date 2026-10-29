import type { IpcMainInvokeEvent } from 'electron'
import { getMainWindow } from './window'

/**
 * Only the app's own main frame may drive privileged control-plane handlers.
 * A preload-exposed API is still reachable by any frame in the renderer, so the
 * main process must check the sender rather than trusting the channel name.
 */
export function assertTrustedMainFrame(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame
  const window = getMainWindow()
  const mainFrame = window?.webContents.mainFrame
  if (!frame || !mainFrame) throw new Error('Untrusted IPC sender.')
  if (frame !== mainFrame) throw new Error('Untrusted IPC sender.')
  if (frame.url !== window?.webContents.getURL()) throw new Error('Untrusted IPC origin.')
}
