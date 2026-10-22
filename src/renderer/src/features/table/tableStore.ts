import { create } from 'zustand'
import { EMPTY_TABLE_STATE } from '@shared/table'
import type {
  TableGoalInput,
  TableJoinInput,
  TableProposalInput,
  TableState
} from '@shared/types'
import { errorMessage } from '../../lib/utils'

const POLL_MS = 1_600

interface TableStore {
  state: TableState
  busy: boolean
  error: string | null
  begin: () => () => void
  host: (name: string) => Promise<boolean>
  join: (input: TableJoinInput) => Promise<boolean>
  setGoal: (input: TableGoalInput) => Promise<boolean>
  propose: (input: TableProposalInput) => Promise<boolean>
  turnKey: (proposalId: string) => Promise<void>
  withdraw: (proposalId: string) => Promise<void>
  publish: (proposalId: string) => Promise<void>
  leave: () => Promise<void>
  clearError: () => void
}

export const useTableStore = create<TableStore>((set, get) => {
  const run = async (action: () => Promise<TableState>): Promise<boolean> => {
    set({ busy: true, error: null })
    try {
      const state = await action()
      set({ state, busy: false })
      return true
    } catch (error) {
      set({ busy: false, error: errorMessage(error) })
      return false
    }
  }

  return {
    state: EMPTY_TABLE_STATE,
    busy: false,
    error: null,

    begin: () => {
      let active = true
      const tick = async (): Promise<void> => {
        try {
          const state = await window.knight.tableGetState()
          if (active) set({ state })
        } catch {
          /* the service is unavailable until the app is ready */
        }
      }
      void tick()
      const timer = setInterval(() => void tick(), POLL_MS)
      return () => {
        active = false
        clearInterval(timer)
      }
    },

    host: (name) => run(() => window.knight.tableHost({ name })),

    join: (input) => run(() => window.knight.tableJoin(input)),

    setGoal: (input) => run(() => window.knight.tableSetGoal(input)),

    propose: (input) => run(() => window.knight.tablePropose(input)),

    turnKey: async (proposalId) => {
      await run(() => window.knight.tableTurnKey(proposalId))
    },

    withdraw: async (proposalId) => {
      await run(() => window.knight.tableWithdraw(proposalId))
    },

    publish: async (proposalId) => {
      await run(() => window.knight.tablePublish(proposalId))
    },

    leave: async () => {
      set({ busy: true })
      try {
        const state = await window.knight.tableLeave()
        set({ state, busy: false, error: null })
      } catch (error) {
        set({ busy: false, error: errorMessage(error) })
      }
    },

    clearError: () => {
      const { state } = get()
      set({ error: null, state: state.error ? { ...state, error: undefined } : state })
    }
  }
})
