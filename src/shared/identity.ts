/**
 * Identity and provenance — the one place the app says who and what it is.
 *
 * Everything user-visible that names this product reads from here, so a rebrand
 * is one file rather than a search-and-replace across the tree. The build stamp
 * is injected by electron.vite.config.ts at bundle time; in dev and in tests it
 * falls back rather than throwing.
 */

export const APP_NAME = 'SelfImpulse'
export const APP_TAGLINE = 'The agent that never leaves your machine.'
export const APP_AUTHOR = 'K.S. / SelfImpulse'

/**
 * The agent's name before its owner chooses one. It is a placeholder that reads
 * correctly mid-sentence, because it appears in UI copy and in the system prompt
 * — the two places must never disagree about what to call the agent.
 */
export const DEFAULT_AGENT_NAME = 'Impulse'

/** Resolve a possibly-unset agent name to something speakable. */
export function resolveAgentName(name?: string): string {
  const trimmed = (name ?? '').trim()
  return trimmed || DEFAULT_AGENT_NAME
}

/**
 * The build mark. Deliberately short and deliberately ours: it is what appears
 * in logs, crash reports and the About pane, so a build can be identified
 * without the user reading a version string.
 */
export const APP_SIGNATURE = 'SI'

/* Injected at bundle time. Declared so TypeScript accepts the reference. */
declare const __SI_COMMIT__: string
declare const __SI_BUILT__: string

function injected(value: unknown): string | null {
  try {
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

export interface BuildStamp {
  version: string
  commit: string | null
  builtAt: string | null
}

/** Provenance for this running build. `commit`/`builtAt` are null when absent. */
export function buildStamp(version: string): BuildStamp {
  let commit: string | null = null
  let builtAt: string | null = null
  try {
    commit = injected(__SI_COMMIT__)
    builtAt = injected(__SI_BUILT__)
  } catch {
    /* Not bundled with the defines — dev or test. */
  }
  return { version, commit, builtAt }
}

/** One line, for logs and the About pane. */
export function signatureLine(version: string): string {
  const stamp = buildStamp(version)
  const commit = stamp.commit ? ` · ${stamp.commit.slice(0, 7)}` : ''
  const built = stamp.builtAt ? ` · built ${stamp.builtAt}` : ''
  return `${APP_NAME} ${stamp.version}${commit}${built} — ${APP_TAGLINE}`
}
