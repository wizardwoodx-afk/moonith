/**
 * THE MAIN-PROCESS `ipc` SEAM.
 *
 * The vendored engine's large renderer bridge (`ipc/client.ts`) answered every
 * verb through `window.selfImpulseDesktop`. In Knight Cowork the engine runs in
 * the main process, so the handful of verbs its execution core actually calls
 * are implemented here against `host/knight.ts` — and nothing else is invented.
 *
 * Call sites: `selfimpulse/engine/providers.ts` (the model call),
 * `mission/hostDeps.ts` (seat keys + the model call). Filesystem and process
 * work in `mission/checkRunner.ts` already takes the Node branch when
 * `window` is absent, so it does not route through here.
 */
import {
  knightChat,
  knightFsList,
  knightFsMkdir,
  knightFsRead,
  knightFsRemove,
  knightFsWrite,
  knightSecretDelete,
  knightSecretExists,
  knightSecretGet,
  knightSecretSet,
  knightShellExec,
  type KnightChatRequest,
  type KnightChatResponse
} from './knight'

export const ipc = {
  llmChat: (req: KnightChatRequest): Promise<KnightChatResponse> => knightChat(req),

  secretExists: async (refs: string[]) => knightSecretExists(refs),
  secretGet: async (ref: string) => {
    const value = knightSecretGet(ref)
    return { ref, present: value !== null, value, redacted: false }
  },
  secretSet: async (ref: string, value: string) => knightSecretSet(ref, value),
  secretDelete: async (ref: string) => knightSecretDelete(ref),

  fsRead: async (path: string) => knightFsRead(path),
  fsList: async (path: string) => knightFsList(path),
  fsWrite: async (path: string, content: string) => knightFsWrite(path, content),
  fsMkdir: async (path: string) => knightFsMkdir(path),
  fsRemove: async (path: string, recursive: boolean) => knightFsRemove(path, recursive),

  shellExec: (program: string, args: string[], cwd?: string, timeoutSecs?: number) =>
    knightShellExec(program, args, cwd, timeoutSecs)
}
