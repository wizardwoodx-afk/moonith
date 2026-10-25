import type { CrewRunEvent, CrewRunEventType, SubAgentRun } from '@shared/types'

const FORWARDED_EVENTS = new Set<CrewRunEventType>([
  'spawned',
  'tool_started',
  'tool_finished',
  'completed',
  'stopped',
  'error'
])

/** Central event filter, equivalent to a supervisor's forwarded-stream allowlist. */
export function shouldForwardCrewEvent(type: CrewRunEventType): boolean {
  return FORWARDED_EVENTS.has(type)
}

export function appendCrewRunEvent(
  run: SubAgentRun,
  input: {
    id: string
    type: CrewRunEventType
    label: string
    at: string
  }
): void {
  if (!shouldForwardCrewEvent(input.type)) return
  const event: CrewRunEvent = {
    ...input,
    agentPath: [...(run.agentPath ?? ['Captain', run.name])]
  }
  run.events = [...(run.events ?? []), event].slice(-80)
}

/** Clone nested run data before crossing the IPC boundary. */
export function crewRunForTransport(run: SubAgentRun): SubAgentRun {
  return {
    ...run,
    steps: run.steps.map((step) => ({ ...step })),
    ...(run.agentPath ? { agentPath: [...run.agentPath] } : {}),
    ...(run.usage ? { usage: { ...run.usage } } : {}),
    ...(run.events
      ? { events: run.events.map((event) => ({ ...event, agentPath: [...event.agentPath] })) }
      : {})
  }
}
