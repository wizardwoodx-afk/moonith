export interface EnterpriseMissionAdmissionRequest {
  missionId: string
  teamId: string
  seats: Array<{ id: string; name: string }>
}

export type EnterpriseMissionAuthorizer = (
  request: EnterpriseMissionAdmissionRequest
) => Promise<unknown>

let authorizer: EnterpriseMissionAuthorizer | null = null

/** Registered by Electron main during startup; keeps the mission graph host-independent. */
export function setEnterpriseMissionAuthorizer(next: EnterpriseMissionAuthorizer): void {
  authorizer = next
}

export async function authorizeEnterpriseMission(
  request: EnterpriseMissionAdmissionRequest
): Promise<void> {
  if (authorizer) {
    await authorizer(request)
    return
  }
  // Production must never silently lose its admission boundary because startup
  // wiring was skipped. Pure non-Electron probes may inject a test authorizer or
  // run without creating a userData profile.
  if (process.type === 'browser') {
    throw new Error('Enterprise Control Plane mission admission was not initialized during startup.')
  }
}
