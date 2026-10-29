import type { KnightApi } from '../shared/types'

declare global {
  interface Window {
    knight: KnightApi
    selfimpulse: KnightApi
  }
}

export {}
