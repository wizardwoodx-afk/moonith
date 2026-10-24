/**
 * The kill switch — the emergency control.
 *
 * Engaged means EVERY governed action is denied, for every agent, until it is
 * released. It is persisted: engaging it survives an app restart, because a
 * kill switch that forgets itself on restart is not a kill switch. The
 * engage/disengage history is recorded so an auditor can see who stopped the
 * agent and when.
 */
export interface KillSwitchState {
  engaged: boolean
  reason: string | null
  at: string | null
  by: string | null
}

export interface KillSwitchStore {
  load(): KillSwitchState | null
  save(state: KillSwitchState): void
}

const DISENGAGED: KillSwitchState = { engaged: false, reason: null, at: null, by: null }

export class KillSwitch {
  private state: KillSwitchState

  constructor(
    private readonly store?: KillSwitchStore,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.state = store?.load() ?? DISENGAGED
  }

  get engaged(): boolean {
    return this.state.engaged
  }

  getState(): KillSwitchState {
    return { ...this.state }
  }

  engage(reason: string, by: string): KillSwitchState {
    this.state = { engaged: true, reason, at: this.now(), by }
    this.store?.save(this.state)
    return this.getState()
  }

  release(by: string): KillSwitchState {
    this.state = { engaged: false, reason: null, at: null, by }
    this.store?.save(this.state)
    return this.getState()
  }
}

/** In-memory store for probes and for hosts without a writable profile. */
export function memoryKillSwitchStore(initial: KillSwitchState | null = null): KillSwitchStore {
  let state = initial
  return {
    load: () => state,
    save: (next) => {
      state = next
    }
  }
}
